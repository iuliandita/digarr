import { ChevronDown, ChevronRight, FileUp, Music, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { importCsvFile, importSpotifyLikedSongs, importSpotifyPlaylist } from '../lib/api'

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
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [importing, setImporting] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleLikedSongs() {
    setImporting('liked-songs')
    try {
      await importSpotifyLikedSongs()
      toast.success(
        'Importing your liked songs -- new artists will appear on the Discover page shortly',
      )
      onImportStarted?.()
    } catch {
      toast.error('Failed to start import')
    } finally {
      setImporting(null)
    }
  }

  async function handlePlaylist() {
    if (!playlistUrl.trim()) return
    setImporting('playlist')
    try {
      await importSpotifyPlaylist(playlistUrl.trim())
      toast.success('Importing playlist artists -- they will appear on the Discover page shortly')
      setPlaylistUrl('')
      onImportStarted?.()
    } catch {
      toast.error('Failed to start playlist import')
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
      toast.success(
        `Importing ${res.artistCount} artists${res.truncated ? ' (limited to 500)' : ''} -- they will appear on the Discover page shortly`,
      )
      onImportStarted?.()
    } catch {
      toast.error('Failed to import CSV file')
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
          Import Artists
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Spotify Liked Songs */}
          <div className="border border-border rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Music size={14} className="text-[#1DB954] shrink-0" />
              <p className="text-sm font-medium text-text">Liked Songs</p>
            </div>
            <p className="text-xs text-muted">Import artists you've liked on Spotify</p>
            {spotifyConnected ? (
              <button
                type="button"
                onClick={handleLikedSongs}
                disabled={importing !== null}
                className="w-full px-3 py-1.5 text-xs bg-accent text-accent-fg rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {importing === 'liked-songs' ? 'Importing...' : 'Import'}
              </button>
            ) : (
              <p className="text-xs text-muted italic">
                Connect Spotify in{' '}
                <Link to="/settings" className="text-accent hover:underline">
                  Settings
                </Link>{' '}
                first
              </p>
            )}
          </div>

          {/* Spotify Playlist */}
          <div className="border border-border rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Music size={14} className="text-[#1DB954] shrink-0" />
              <p className="text-sm font-medium text-text">Spotify Playlist</p>
            </div>
            <p className="text-xs text-muted">Import artists from any Spotify playlist</p>
            {spotifyConnected ? (
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  placeholder="Playlist URL or ID"
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
                  {importing === 'playlist' ? '...' : 'Go'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-muted italic">
                Connect Spotify in{' '}
                <Link to="/settings" className="text-accent hover:underline">
                  Settings
                </Link>{' '}
                first
              </p>
            )}
          </div>

          {/* CSV Upload */}
          <div className="border border-border rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2">
              <FileUp size={14} className="text-muted shrink-0" />
              <p className="text-sm font-medium text-text">CSV File</p>
            </div>
            <p className="text-xs text-muted">Upload a list of artist names from a CSV file</p>
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
              {importing === 'csv' ? 'Uploading...' : 'Choose File'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
