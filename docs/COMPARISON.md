# Other self-hosted music projects

Digarr is for finding and reviewing music, then sending approved choices to connected services. It can run without Lidarr, but it does not provide its own downloader or full music player. You can use manual approval or enable automatic approval above a score threshold. Automatic album approval uses artist-level monitoring and can include the whole discography; check the [known limitations](OPERATIONS.md#known-limitations-in-v1190).

When choosing a tool, start with your setup:

- Do you want to review suggestions, or have music added automatically?
- Do you need recommendations, playlist generation, requests, downloads, or playback?
- Which listening services and media servers do you already use?
- Do you need separate accounts and libraries for different people?
- Can you use your own AI provider, and where will it receive your data?

## Projects to explore

Check each project's current documentation for supported services, setup requirements, and the workflows you need.

- [SoulSync](https://github.com/Nezreka/SoulSync)
- [Explo](https://github.com/LumePart/Explo)
- [Aurral](https://github.com/lklynet/aurral)
- [Kima Hub](https://github.com/Chevron7Locked/kima-hub)
- [DroppedNeedle](https://github.com/DroppedNeedle/DroppedNeedle)
- [MixArr](https://github.com/aquantumofdonuts/mixarr)
- [Lidify](https://github.com/TheWicklowWolf/Lidify)
- [Curatorr](https://github.com/MickyGX/curatorr)
- [Brainarr](https://github.com/RicherTunes/Brainarr)
- [Sonobarr](https://github.com/Dodelidoo-Labs/sonobarr)

[MusicMoveArr Datasets](https://github.com/MusicMoveArr/Datasets) provides music metadata datasets. Digarr has a generic CSV importer at `scripts/import-artist-metadata.ts`. Prepare a CSV with the headers `artist_name,spotify_genres,spotify_popularity,deezer_fans`; `spotify_genres` uses pipe-delimited values such as `indie rock|shoegaze`. No direct dataset integration is bundled.

## What to check in Digarr

The [README](../README.md) covers the current feature set and installation paths. Before deciding, check its notes on Spotify app requirements, experimental TIDAL support, and playlist library requirements. Check the [image channels](../deploy/docker/README.md#image-channels) for the difference between `:nightly` and tagged releases. These constraints matter more than a feature count.
