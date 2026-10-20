import { describe, expect, it } from 'vitest'
import { affectedRoutesByImports, aliasesFromTsconfig, importSpecifiers } from './imports.js'
import { routesFromFiles } from './routes.js'

describe('importSpecifiers', () => {
  it('finds static, re-exported, dynamic and required imports', () => {
    const source = `
      import React from 'react'
      import { TextField } from '@/components/text-field'
      import type { Note } from '../store/notes'
      export { Button } from './button'
      import './polyfills'
      const Lazy = import('./lazy')
      const legacy = require("../legacy")
    `
    expect(importSpecifiers(source).sort()).toEqual(
      [
        '../legacy',
        '../store/notes',
        './button',
        './lazy',
        './polyfills',
        '@/components/text-field',
        'react',
      ].sort(),
    )
  })
})

describe('aliasesFromTsconfig', () => {
  it('reads paths, allowing comments and trailing commas', () => {
    const tsconfig = `{
      // Expo's base config
      "extends": "expo/tsconfig.base",
      "compilerOptions": { "paths": { "@/*": ["./src/*"], "@/assets/*": ["./assets/*"], }, },
    }`
    expect(aliasesFromTsconfig(tsconfig, 'apps/mobile')).toEqual([
      { prefix: '@/', target: 'apps/mobile/src/' },
      { prefix: '@/assets/', target: 'apps/mobile/assets/' },
    ])
    expect(aliasesFromTsconfig('not json', '.')).toEqual([])
  })

  it("keeps glob strings that look like comments (Expo's default tsconfig)", () => {
    const expoDefault = JSON.stringify({
      extends: 'expo/tsconfig.base',
      compilerOptions: { strict: true, paths: { '@/*': ['./src/*'] } },
      include: ['**/*.ts', '**/*.tsx', '.expo/types/**/*.ts', 'expo-env.d.ts'],
    })
    expect(aliasesFromTsconfig(expoDefault, '.')).toEqual([{ prefix: '@/', target: 'src/' }])
  })
})

describe('affectedRoutesByImports', () => {
  // The notes app, simplified: a shared TextField used through NoteForm by two screens.
  const sources = new Map([
    ['src/app/index.tsx', "import { NoteRow } from '@/components/note-row'"],
    ['src/app/notes/new.tsx', "import { NoteForm } from '@/components/note-form'"],
    ['src/app/notes/[id]/edit.tsx', "import { NoteForm } from '@/components/note-form'"],
    ['src/app/notes/[id]/index.tsx', "import { Button } from '@/components/button'"],
    ['src/app/settings.tsx', "import { Button } from '../components/button'"],
    [
      'src/components/note-form.tsx',
      "import { TextField } from './text-field'\nimport { Button } from './button'",
    ],
    ['src/components/text-field.tsx', "import { View } from 'react-native'"],
    ['src/components/button.tsx', "import { Pressable } from 'react-native'"],
    ['src/components/note-row.tsx', "import { Link } from 'expo-router'"],
  ])
  const routes = routesFromFiles('src/app', [...sources.keys()])
  const aliases = [{ prefix: '@/', target: 'src/' }]

  it('finds the screens a shared component reaches, with the import distance', () => {
    expect(
      affectedRoutesByImports({
        routes,
        changedFiles: ['src/components/text-field.tsx'],
        sources,
        aliases,
      }),
    ).toEqual([
      { path: '/notes/[id]/edit', distance: 2, via: 'src/components/text-field.tsx' },
      { path: '/notes/new', distance: 2, via: 'src/components/text-field.tsx' },
    ])
  })

  it('keeps the closest path when several changed files reach a route', () => {
    const affected = affectedRoutesByImports({
      routes,
      changedFiles: ['src/components/button.tsx', 'src/app/notes/new.tsx'],
      sources,
      aliases,
    })
    expect(affected.find((a) => a.path === '/notes/new')).toEqual({
      path: '/notes/new',
      distance: 0,
      via: 'src/app/notes/new.tsx',
    })
    expect(affected.find((a) => a.path === '/settings')?.distance).toBe(1)
    expect(affected.find((a) => a.path === '/notes/[id]/edit')?.distance).toBe(2)
  })

  it('ignores files nothing imports and stops at the distance limit', () => {
    expect(
      affectedRoutesByImports({ routes, changedFiles: ['README.md'], sources, aliases }),
    ).toEqual([])
    expect(
      affectedRoutesByImports({
        routes,
        changedFiles: ['src/components/text-field.tsx'],
        sources,
        aliases,
        maxDistance: 1,
      }),
    ).toEqual([])
  })
})
