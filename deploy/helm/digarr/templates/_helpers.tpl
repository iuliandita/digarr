{{/*
Expand the name of the chart.
*/}}
{{- define "digarr.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "digarr.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label.
*/}}
{{- define "digarr.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "digarr.labels" -}}
helm.sh/chart: {{ include "digarr.chart" . }}
{{ include "digarr.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "digarr.selectorLabels" -}}
app.kubernetes.io/name: {{ include "digarr.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Database secret name -- prefers existingSecret, falls back to chart-managed secret.
*/}}
{{- define "digarr.databaseSecretName" -}}
{{- if .Values.database.existingSecret }}
{{- .Values.database.existingSecret }}
{{- else }}
{{- include "digarr.fullname" . }}-db
{{- end }}
{{- end }}

{{/*
PostgreSQL hostname -- bundled service or external host.
*/}}
{{- define "digarr.postgresHost" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "%s-postgresql" (include "digarr.fullname" .) }}
{{- else }}
{{- .Values.database.host }}
{{- end }}
{{- end }}

{{/*
ServiceAccount name -- uses override if supplied, otherwise derives from fullname.
*/}}
{{- define "digarr.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "digarr.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
App image reference -- prefer digest when provided.
*/}}
{{- define "digarr.image" -}}
{{- if .Values.image.digest }}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest }}
{{- else }}
{{- printf "%s:%s" .Values.image.repository .Values.image.tag }}
{{- end }}
{{- end }}

{{/*
PostgreSQL image reference -- prefer digest when provided.
*/}}
{{- define "digarr.postgresqlImage" -}}
{{- if .Values.postgresql.image.digest }}
{{- printf "%s@%s" .Values.postgresql.image.repository .Values.postgresql.image.digest }}
{{- else }}
{{- printf "%s:%s" .Values.postgresql.image.repository .Values.postgresql.image.tag }}
{{- end }}
{{- end }}
