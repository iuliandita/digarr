import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[2]
CHART = ROOT / "deploy/helm/digarr"


def render(values):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json") as values_file:
        json.dump(values, values_file)
        values_file.flush()
        result = subprocess.run(
            ["helm", "template", "encoding", str(CHART), "-f", values_file.name],
            check=True,
            capture_output=True,
            text=True,
        )
    return re.split(r"^---\s*$", result.stdout, flags=re.MULTILINE)


def document(documents, kind):
    return next(doc for doc in documents if f"\nkind: {kind}\n" in doc)


def secret_values(documents):
    secret = document(documents, "Secret")
    return {
        key: json.loads(value)
        for key, value in re.findall(r'^  (\w+): (".*")$', secret, re.MULTILINE)
    }


class DatabaseUrlTest(unittest.TestCase):
    def test_generated_urls_encode_each_component(self):
        cases = [
            (
                "user!$&'()*+,;=:@/?#[]",
                "pass!$&'()*+,;=:@/?#[]",
                "db!$&'()*+,;=:@/?#[]",
            ),
            ("user%40", "pass%2F", "db%23"),
            ("user +caf\u00e9", "pass +caf\u00e9", "db +caf\u00e9"),
            ("user-._~09", "pass-._~09", "db-._~09"),
        ]
        for bundled in (True, False):
            for user, password, name in cases:
                with self.subTest(bundled=bundled, user=user):
                    values = {
                        "postgresql": {"enabled": bundled},
                        "database": {"host": "db.example.com", "port": 5544},
                    }
                    if bundled:
                        values["postgresql"]["auth"] = {
                            "username": user,
                            "password": password,
                            "database": name
                        }
                    else:
                        values["database"].update(
                            user=user, password=password, name=name
                        )
                    documents = render(values)
                    data = secret_values(documents)
                    host = (
                        "encoding-digarr-postgresql:5432"
                        if bundled else "db.example.com:5544"
                    )
                    expected = (
                        f"postgresql://{quote(user, safe='')}:"
                        f"{quote(password, safe='')}@{host}/{quote(name, safe='')}"
                    )
                    self.assertEqual(data["DATABASE_URL"], expected)
                    if bundled:
                        self.assertEqual(data["POSTGRES_PASSWORD"], password)
                        workload = document(documents, "StatefulSet")
                        for variable, raw in (
                            ("POSTGRES_USER", user), ("POSTGRES_DB", name)
                        ):
                            value = re.search(
                                rf"- name: {variable}\n\s+value: (.*)", workload
                            ).group(1)
                            self.assertEqual(json.loads(value), raw)
                    else:
                        self.assertNotIn("POSTGRES_PASSWORD", data)

    def test_existing_secret_skips_generated_url_and_password_requirement(self):
        documents = render({
            "postgresql": {"enabled": False},
            "database": {"existingSecret": "provided-database", "password": ""},
        })
        self.assertFalse(any("\nkind: Secret\n" in doc for doc in documents))
        deployment = document(documents, "Deployment")
        self.assertRegex(
            deployment,
            r"- name: DATABASE_URL\n\s+valueFrom:\n\s+secretKeyRef:"
            r"\n\s+name: provided-database\n\s+key: DATABASE_URL",
        )

    def test_generated_url_requires_password(self):
        for bundled in (True, False):
            with self.subTest(bundled=bundled):
                with self.assertRaises(subprocess.CalledProcessError) as failure:
                    render({"postgresql": {"enabled": bundled}})
                self.assertIn("password", failure.exception.stderr)

    def test_pglite_omits_postgres_secret(self):
        documents = render({"database": {"backend": "pglite"}})
        self.assertFalse(any("\nkind: Secret\n" in doc for doc in documents))
        self.assertFalse(any("\nkind: StatefulSet\n" in doc for doc in documents))
        deployment = document(documents, "Deployment")
        self.assertNotIn("- name: DATABASE_URL", deployment)
        self.assertIn("- name: DB_PATH", deployment)


if __name__ == "__main__":
    unittest.main()
