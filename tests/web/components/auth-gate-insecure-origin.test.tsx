// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { isInsecureRemoteOrigin } from '@/web/components/auth-gate'

describe('isInsecureRemoteOrigin', () => {
  it.each([
    ['http:', '192.168.1.50'],
    ['http:', '10.0.0.4'],
    ['http:', 'nas.lan'],
    ['http:', 'digarr.example.com'],
    ['http:', '[fd00::1]'],
  ])('flags plain HTTP served from %s//%s', (protocol, hostname) => {
    expect(isInsecureRemoteOrigin({ protocol, hostname })).toBe(true)
  })

  it.each([
    ['http:', 'localhost'],
    ['http:', 'LOCALHOST'],
    ['http:', 'app.localhost'],
    ['http:', '127.0.0.1'],
    ['http:', '[::1]'],
  ])('treats %s//%s as a secure context', (protocol, hostname) => {
    expect(isInsecureRemoteOrigin({ protocol, hostname })).toBe(false)
  })

  it.each([
    ['https:', 'digarr.example.com'],
    ['https:', '192.168.1.50'],
    ['https:', 'localhost'],
  ])('never flags %s//%s', (protocol, hostname) => {
    expect(isInsecureRemoteOrigin({ protocol, hostname })).toBe(false)
  })
})
