import { describe, expect, it } from 'vitest'
import { parseLaunchUrl } from './url.js'

const token = 'eyJhbGciOiJFUzI1NiJ9.eyJzY24iOiJ4In0.c2ln'

describe('parseLaunchUrl', () => {
  it.each([
    ['custom scheme', `acmenotes://tapthrough/launch?t=${token}`],
    ['universal link', `https://preview.acme.com/tapthrough/launch?t=${token}`],
    ['native-intent path', `/tapthrough/launch?t=${token}`],
    ['path without a leading slash', `tapthrough/launch?t=${token}`],
    ['trailing slash', `acmenotes://tapthrough/launch/?t=${token}`],
    ['other params first', `acmenotes://tapthrough/launch?src=qr&t=${token}`],
    ['other params after', `acmenotes://tapthrough/launch?t=${token}&src=qr`],
    ['a fragment', `acmenotes://tapthrough/launch?t=${token}#x`],
    [
      'an Expo dev client prefix',
      `exp+acme://expo-development-client/tapthrough/launch?t=${token}`,
    ],
  ])('reads the token from a %s', (_, url) => {
    expect(parseLaunchUrl(url)).toBe(token)
  })

  it('decodes an encoded token', () => {
    expect(parseLaunchUrl('acme://tapthrough/launch?t=a%2Eb%2Ec')).toBe('a.b.c')
  })

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['another screen', 'acmenotes://notes/12'],
    ['no token', 'acmenotes://tapthrough/launch'],
    ['an empty token', 'acmenotes://tapthrough/launch?t='],
    ['a lookalike param', 'acmenotes://tapthrough/launch?st=abc'],
    ['a lookalike path', 'acmenotes://nottapthrough/launch?t=abc'],
    ['a deeper path', 'acmenotes://tapthrough/launch/extra?t=abc'],
    ['broken encoding', 'acmenotes://tapthrough/launch?t=%E0%A4%A'],
  ])('returns null for %s', (_, url) => {
    expect(parseLaunchUrl(url)).toBeNull()
  })
})
