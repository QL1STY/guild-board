import { expect, test } from 'vitest'
import { ALLOWED_DOMAINS, EXTERNAL_LINKS, isHoyoverse, opensOutside, sameOrigin, SIGN_IN_HOSTS, signInSite } from '../src/links.js'

test('the seven external prefixes are the Qt shell’s, each ending in a slash', () => {
  expect(EXTERNAL_LINKS).toEqual([
    'https://genshin-impact.fandom.com/',
    'https://act.hoyolab.com/ys/app/interactive-map/',
    'https://akasha.cv/profile/',
    'https://enka.network/u/',
    'https://act.hoyolab.com/app/community-game-records-sea/',
    'https://act.hoyolab.com/ys/event/signin-sea-v3/',
    'https://github.com/QL1STY/guild-board/',
  ])
  for (const prefix of EXTERNAL_LINKS) expect(prefix.endsWith('/')).toBe(true)
})

test('a link opens outside only on one of the seven prefixes', () => {
  for (const prefix of EXTERNAL_LINKS) expect(opensOutside(`${prefix}x`)).toBe(true)
  expect(opensOutside('https://github.com/QL1STY/guild-board/issues')).toBe(true)
  expect(opensOutside('https://github.com.evil.example/QL1STY/guild-board/')).toBe(false)
  expect(opensOutside('https://github.com/QL1STY/guild-board')).toBe(false)
  expect(opensOutside('https://github.com/QL1STY/guild-board-releases/')).toBe(false)
  expect(opensOutside('http://github.com/QL1STY/guild-board/')).toBe(false)
  expect(opensOutside('https://github.com@evil.example/QL1STY/guild-board/')).toBe(false)
  expect(opensOutside('')).toBe(false)
})

test('HoYoverse’s domains', () => {
  expect(ALLOWED_DOMAINS).toEqual(['hoyolab.com', 'hoyoverse.com', 'mihoyo.com'])
  expect(isHoyoverse('https://act.hoyolab.com/x')).toBe(true)
  expect(isHoyoverse('https://hoyolab.com/')).toBe(true)
  expect(isHoyoverse('https://sg-wiki-api.hoyolab.com/a')).toBe(true)
  expect(isHoyoverse('https://upload-static.hoyoverse.com/a.png')).toBe(true)
  expect(isHoyoverse('https://ACT.HoYoLAB.com./x')).toBe(true)
  expect(isHoyoverse('http://act.hoyolab.com/')).toBe(false)
  expect(isHoyoverse('https://hoyolab.com.evil.example/')).toBe(false)
  expect(isHoyoverse('https://evilhoyolab.com/')).toBe(false)
  expect(isHoyoverse('https://evil.example/?u=https://act.hoyolab.com/')).toBe(false)
  expect(isHoyoverse('https://evil.example\\@act.hoyolab.com/')).toBe(false)
  expect(isHoyoverse('wss://act.hoyolab.com/')).toBe(false)
  expect(isHoyoverse('not a url')).toBe(false)
  expect(isHoyoverse('')).toBe(false)
})

test('the eight sign-in hosts pass over https only', () => {
  expect(SIGN_IN_HOSTS).toEqual([
    'accounts.google.com', 'www.facebook.com', 'm.facebook.com', 'appleid.apple.com', 'x.com', 'twitter.com',
    'api.twitter.com', 'discord.com',
  ])
  for (const host of SIGN_IN_HOSTS) {
    expect(signInSite(`https://${host}/login`)).toBe(true)
    expect(signInSite(`http://${host}/login`)).toBe(false)
  }
  expect(signInSite('https://act.hoyolab.com/x')).toBe(true) // HoYoverse’s own sites too
  expect(signInSite('https://www.gstatic.com/')).toBe(false)
  expect(signInSite('https://accounts.google.com.evil.example/')).toBe(false)
  expect(signInSite('https://evil.example/accounts.google.com')).toBe(false)
  expect(signInSite('https://accounts.google.com:8443/')).toBe(false)
  expect(signInSite('https://user@accounts.google.com/')).toBe(false)
  expect(signInSite('https://sub.discord.com/')).toBe(false)
  expect(signInSite('nonsense')).toBe(false)
})

test('same origin', () => {
  const origin = 'http://127.0.0.1:5123'
  expect(sameOrigin('http://127.0.0.1:5123/api/x?y=1', origin)).toBe(true)
  expect(sameOrigin('http://127.0.0.1:5124/', origin)).toBe(false)
  expect(sameOrigin('https://127.0.0.1:5123/', origin)).toBe(false)
  expect(sameOrigin('http://localhost:5123/', origin)).toBe(false)
  expect(sameOrigin('http://127.0.0.1:5123@evil.example/', origin)).toBe(false)
  expect(sameOrigin('data:text/plain,hi', origin)).toBe(false)
  expect(sameOrigin('about:blank', 'about:blank')).toBe(false) // an opaque origin is never the same
  expect(sameOrigin('junk', origin)).toBe(false)
  expect(sameOrigin('http://127.0.0.1:5123/', 'junk')).toBe(false)
})
