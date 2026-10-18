import * as z from 'zod'

export const DASHBOARD_CARD_IDS = [
  'pick',
  'decisions',
  'listening',
  'genres',
  'subscriptions',
] as const
export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number]
export const DASHBOARD_CARD_SIZES = ['small', 'medium', 'large'] as const
export type DashboardCardSize = (typeof DASHBOARD_CARD_SIZES)[number]
export type DashboardCard = { id: DashboardCardId; visible: boolean; size: DashboardCardSize }
export const DECISIONS_GRID_COLUMNS = [2, 3, 4, 5, 6] as const
export const DECISIONS_GRID_ROWS = [1, 2, 3, 4] as const
export type DecisionsGrid = { columns: number; rows: number }
export const DEFAULT_DECISIONS_GRID: DecisionsGrid = { columns: 3, rows: 3 }
export type DashboardLayout = {
  version: 1
  cards: DashboardCard[]
  showEmpty: boolean
  decisionsGrid?: DecisionsGrid
}

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  version: 1,
  cards: [
    { id: 'pick', visible: true, size: 'large' },
    { id: 'decisions', visible: true, size: 'medium' },
    { id: 'listening', visible: true, size: 'medium' },
    { id: 'genres', visible: true, size: 'small' },
    { id: 'subscriptions', visible: true, size: 'small' },
  ],
  showEmpty: false,
}

export const dashboardLayoutSchema = z
  .object({
    version: z.literal(1),
    cards: z
      .array(z.object({ id: z.string().max(64) }).passthrough())
      .max(64)
      .transform((cards) => cards.filter((card) => DASHBOARD_CARD_IDS.some((id) => id === card.id)))
      .pipe(
        z.array(
          z.object({
            id: z.enum(DASHBOARD_CARD_IDS),
            visible: z.boolean(),
            size: z.enum(DASHBOARD_CARD_SIZES),
          }),
        ),
      ),
    showEmpty: z.boolean(),
    decisionsGrid: z
      .object({
        columns: z.number().int().min(2).max(6),
        rows: z.number().int().min(1).max(4),
      })
      .optional(),
  })
  .transform((layout): DashboardLayout => {
    const cards: DashboardCard[] = []
    for (const card of layout.cards) {
      const id = DASHBOARD_CARD_IDS.find((id) => id === card.id)
      if (id && !cards.some((existing) => existing.id === id)) cards.push({ ...card, id })
    }
    // Insert newly introduced cards at their default index without reordering saved cards.
    DEFAULT_DASHBOARD_LAYOUT.cards.forEach((card, index) => {
      if (!cards.some((existing) => existing.id === card.id)) {
        cards.splice(Math.min(index, cards.length), 0, { ...card })
      }
    })
    return {
      version: 1,
      cards,
      showEmpty: layout.showEmpty,
      ...(layout.decisionsGrid ? { decisionsGrid: layout.decisionsGrid } : {}),
    }
  })

export function mergeDashboardLayout(raw: unknown): DashboardLayout {
  const parsed = dashboardLayoutSchema.safeParse(raw)
  return parsed.success
    ? parsed.data
    : {
        ...DEFAULT_DASHBOARD_LAYOUT,
        cards: DEFAULT_DASHBOARD_LAYOUT.cards.map((card) => ({ ...card })),
      }
}
