import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthCookie } from './auth'
import { installDiscoverListView, seedRecommendations } from './seed'

test.describe('Spotify preview bridge', () => {
  test('isolates the controller and keeps fallback responsive after failure', async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return

    await seedRecommendations(page.request, token)
    await installAuthCookie(page)
    await installDiscoverListView(page)
    await page.route('**/spotify-embed-bridge.html', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html>
          <script>
            window.bridgeReady = false;
            window.addEventListener('message', (event) => {
              const port = event.ports[0];
              if (!port) return;
              window.bridgeReady = true;
              window.triggerBridgeReady = () => {
                port.postMessage({ type: 'ready', token: event.data.token });
              };
              window.triggerPlaybackStarted = () => {
                port.postMessage({ type: 'playback-started', token: event.data.token });
              };
              window.triggerBridgeFailure = () => {
                port.postMessage({ type: 'failure', token: event.data.token });
              };
            });
          </script>`,
      }),
    )

    await page.goto('/discover')
    const card = page.locator('[data-testid="rec-card-button"]').first()
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.getByRole('button', { name: /play preview/i }).click()

    const bridgeElement = page.locator('iframe[src="/spotify-embed-bridge.html"]')
    await expect(bridgeElement).toHaveAttribute('sandbox', 'allow-scripts')
    const bridgeFrame = page.frames().find((frame) => frame.url().includes('spotify-embed-bridge'))
    expect(bridgeFrame).toBeTruthy()
    if (!bridgeFrame) return

    await bridgeFrame.waitForFunction(() => Boolean(window.bridgeReady))
    const parentAccessBlocked = await bridgeFrame.evaluate(() => {
      try {
        void window.parent.document.body
        return false
      } catch {
        return true
      }
    })
    expect(parentAccessBlocked).toBe(true)

    await bridgeFrame.evaluate(() => {
      window.triggerBridgeReady?.()
      window.triggerPlaybackStarted?.()
    })
    await expect(card.getByRole('button', { name: /stop preview/i })).toBeVisible()

    await bridgeFrame.evaluate(() => window.triggerBridgeFailure?.())
    await expect(bridgeElement).toHaveCount(0)
    await expect(
      page.locator('iframe[src^="https://open.spotify.com/embed/artist/seedalpha"]'),
    ).toBeVisible()

    await page.getByRole('button', { name: /close preview/i }).click()
    await expect(page.getByRole('region', { name: /preview player/i })).toHaveCount(0)
  })
})

declare global {
  interface Window {
    bridgeReady?: boolean
    triggerBridgeReady?: () => void
    triggerPlaybackStarted?: () => void
    triggerBridgeFailure?: () => void
  }
}
