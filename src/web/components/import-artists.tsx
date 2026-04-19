import { ChevronDown, ChevronRight, FileUp, Music, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { importCsvFile, importSpotifyLikedSongs, importSpotifyPlaylist } from '../lib/api'
import { useI18n } from '../lib/i18n'

type ImportArtistsProps = {
  spotifyConnected: boolean
  defaultExpanded?: boolean
  onImportStarted?: () => void
}

export function ImportArtists({
  spotifyConnected,
  defaultExpanded = false,
  onImportStarted,
}: ImportArtistsProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [importing, setImporting] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleLikedSongs() {
    setImporting('liked-songs')
    try {
      await importSpotifyLikedSongs()
      toast.success(t('importArtists.importingLikedSongs'))
      onImportStarted?.()
    } catch {
      toast.error(t('importArtists.failedImport'))
    } finally {
      setImporting(null)
    }
  }

  async function handlePlaylist() {
    if (!playlistUrl.trim()) return
    setImporting('playlist')
    try {
      await importSpotifyPlaylist(playlistUrl.trim())
      toast.success(t('importArtists.importingPlaylist'))
      setPlaylistUrl('')
      onImportStarted?.()
    } catch {
      toast.error(t('importArtists.failedPlaylist'))
    } finally {
      setImporting(null)
    }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting('csv')
    try {
      const res = await importCsvFile(file)
      const msg = res.truncated
        ? t('importArtists.importingCsvTruncated').replace('{0}', String(res.artistCount))
        : t('importArtists.importingCsv').replace('{0}', String(res.artistCount))
      toast.success(msg)
      onImportStarted?.()
    } catch {
      toast.error(t('importArtists.failedCsv'))
    } finally {
      setImporting(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="bg-surface border border-border rounded-lg">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-text hover:bg-bg/50 transition-colors rounded-lg"
      >
        <span className="flex items-center gap-2">
          <Upload size={14} />
          {t('importArtists.title')}
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Spotify Liked Songs */}
          <div className="border border-border rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Music size={14} className="text-[#1DB954] shrink-0" />
              <p className="text-sm font-medium text-text">{t('importArtists.likedSongs')}</p>
            </div>
            <p className="text-xs text-muted">{t('importArtists.likedSongsDescription')}</p>
            {spotifyConnected ? (
              <button
                type="button"
                onClick={handleLikedSongs}
                disabled={importing !== null}
                className="w-full px-3 py-1.5 text-xs bg-accent text-accent-fg rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {importing === 'liked-songs' ? t('common.importing') : t('importArtists.import')}
              </button>
            ) : (
              <p className="text-xs text-muted italic">
                {t('importArtists.connectSpotifyFirst').split('{0}')[0]}
                <Link to="/settings" className="text-accent underline">
                  {t('nav.settings')}
                </Link>
                {t('importArtists.connectSpotifyFirst').split('{0}')[1]}
              </p>
            )}
          </div>

          {/* Spotify Playlist */}
          <div className="border border-border rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Music size={14} className="text-[#1DB954] shrink-0" />
              <p className="text-sm font-medium text-text">{t('importArtists.spotifyPlaylist')}</p>
            </div>
            <p className="text-xs text-muted">{t('importArtists.spotifyPlaylistDescription')}</p>
            {spotifyConnected ? (
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  placeholder={t('importArtists.playlistPlaceholder')}
                  className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-bg border border-border rounded-md text-text placeholder:text-muted/60 focus:outline-none focus:border-accent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handlePlaylist()
                  }}
                />
                <button
                  type="button"
                  onClick={handlePlaylist}
                  disabled={!playlistUrl.trim() || importing !== null}
                  className="px-2.5 py-1.5 text-xs bg-accent text-accent-fg rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
                >
                  {importing === 'playlist' ? '...' : t('importArtists.go')}
                </button>
              </div>
            ) : (
              <p className="text-xs text-muted italic">
                {t('importArtists.connectSpotifyFirst').split('{0}')[0]}
                <Link to="/settings" className="text-accent underline">
                  {t('nav.settings')}
                </Link>
                {t('importArtists.connectSpotifyFirst').split('{0}')[1]}
              </p>
            )}
          </div>

          {/* CSV Upload */}
          <div className="border border-border rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2">
              <FileUp size={14} className="text-muted shrink-0" />
              <p className="text-sm font-medium text-text">{t('importArtists.csvFile')}</p>
            </div>
            <p className="text-xs text-muted">{t('importArtists.csvDescription')}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleCsvUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing !== null}
              className="w-full px-3 py-1.5 text-xs bg-accent text-accent-fg rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {importing === 'csv' ? t('importArtists.uploading') : t('importArtists.chooseFile')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
