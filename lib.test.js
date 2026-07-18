const { test, expect } = require('bun:test')
const path = require('path')
const lib = require('./lib')

const HOME = process.env.HOME

test('expandTilde expands a leading ~/ to HOME', () => {
  expect(lib.expandTilde('~/claude-sessions')).toBe(path.join(HOME, 'claude-sessions'))
})

test('expandTilde expands a bare ~ to HOME', () => {
  expect(lib.expandTilde('~')).toBe(HOME)
})

test('expandTilde leaves absolute paths unchanged', () => {
  expect(lib.expandTilde('/tmp/sessions')).toBe('/tmp/sessions')
})

test('expandTilde does not expand ~user forms', () => {
  expect(lib.expandTilde('~other/sessions')).toBe('~other/sessions')
})

test('expandTilde passes through null/undefined', () => {
  expect(lib.expandTilde(null)).toBe(null)
  expect(lib.expandTilde(undefined)).toBe(undefined)
})
