import { describe, expect, it } from 'vitest'
import { formatAppKey, repoFromRemote } from './app-key.js'

describe('repoFromRemote', () => {
  it('reads SSH and HTTPS GitHub remotes', () => {
    expect(repoFromRemote('git@github.com:acme/notes.git')).toBe('acme/notes')
    expect(repoFromRemote('https://github.com/acme/notes')).toBe('acme/notes')
    expect(repoFromRemote('https://github.com/acme/my.app.git\n')).toBe('acme/my.app')
  })

  it('ignores other hosts', () => {
    expect(repoFromRemote('https://gitlab.com/acme/notes.git')).toBeUndefined()
  })
})

describe('formatAppKey', () => {
  it('says where the key goes and warns off store builds', () => {
    const text = formatAppKey({ appKey: 'abc', repo: 'acme/notes' })
    expect(text).toContain('eas env:create --name TAPTHROUGH_APP_KEY')
    expect(text).toContain("staff: process.env.APP_VARIANT === 'staging'")
    expect(text).toContain('Never turn `staff` on')
  })
})
