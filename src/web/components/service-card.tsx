import type * as React from 'react'
import { useI18n } from '../lib/i18n'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'

type ServiceStatus = 'connected' | 'not_configured' | 'error' | 'testing'

export type ServiceCardProps = {
  name: string
  description?: React.ReactNode
  status: ServiceStatus
  icon?: React.ReactNode
  onTest?: () => void
  children: React.ReactNode
}

function StatusIndicator({ status }: { status: ServiceStatus }) {
  const { t } = useI18n()

  if (status === 'testing') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <span className="inline-block h-2 w-2 rounded-full bg-muted animate-pulse" />
        {t('service.testing')}
      </span>
    )
  }

  const dot: Record<Exclude<ServiceStatus, 'testing'>, string> = {
    connected: 'bg-approve',
    not_configured: 'bg-muted',
    error: 'bg-reject',
  }

  const labelKey: Record<
    Exclude<ServiceStatus, 'testing'>,
    'service.connected' | 'service.notConfigured' | 'service.error'
  > = {
    connected: 'service.connected',
    not_configured: 'service.notConfigured',
    error: 'service.error',
  }

  const textColor: Record<Exclude<ServiceStatus, 'testing'>, string> = {
    connected: 'text-approve',
    not_configured: 'text-muted',
    error: 'text-reject',
  }

  return (
    <span className={`flex items-center gap-1.5 text-xs ${textColor[status]}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${dot[status]}`} />
      {t(labelKey[status])}
    </span>
  )
}

export function ServiceCard({
  name,
  description,
  status,
  icon,
  onTest,
  children,
}: ServiceCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle>
            <span className="flex items-center gap-2">
              {icon}
              {name}
            </span>
          </CardTitle>
          <StatusIndicator status={status} />
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
      {onTest && (
        <CardFooter>
          <Button variant="outline" size="sm" onClick={onTest} disabled={status === 'testing'}>
            Test Connection
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
