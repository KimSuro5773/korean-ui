// 기본 번역표의 patterns 섹션을 읽고, 바뀌는 값이 들어간 원문에 맞는 번역문을 만드는 함수들입니다.
// 예: 'Toggle fast mode ({model})'은 'Toggle fast mode (Sonnet 5.5)'에 맞고, {model} 자리에 'Sonnet 5.5'를 넣은 번역문을 만듭니다.
// Claude Code API($)를 쓰지 않으므로 Claude Code 없이 테스트할 수 있습니다.
import type { Kind } from './translation'

// 원문 패턴 하나입니다. regex는 원문 전체에 맞추는 정규식이고, 자리표시자마다 같은 이름의 그룹이 있습니다.
export type Pattern = { source: string; translated: string; regex: RegExp }

// 명령어 설명과 /config 항목의 패턴을 번역표에 적힌 순서대로 담습니다.
export type PatternTable = Record<Kind, Pattern[]>

const PLACEHOLDER = /\{([a-z]+)\}/g
const PATTERN_KINDS: readonly Kind[] = ['commands', 'config']

// 빈 패턴 표를 만듭니다.
export function emptyPatterns(): PatternTable {
  return { commands: [], config: [] }
}

// 기본 번역표 전체에서 patterns 섹션을 읽습니다. 규칙에 맞지 않는 패턴은 버리고, 버린 원문 패턴을 함께 돌려줍니다.
export function parsePatterns(raw: unknown): { table: PatternTable; dropped: string[] } {
  const table = emptyPatterns()
  const dropped: string[] = []
  const section = isRecord(raw) ? raw['patterns'] : undefined
  if (!isRecord(section)) return { table, dropped }
  for (const kind of PATTERN_KINDS) {
    const entries = section[kind]
    if (!isRecord(entries)) continue
    for (const [source, translated] of Object.entries(entries)) {
      const pattern = typeof translated === 'string' ? makePattern(source, translated) : undefined
      if (pattern === undefined) dropped.push(source)
      else table[kind].push(pattern)
    }
  }
  return { table, dropped }
}

// 원문에 맞는 패턴을 번역표에 적힌 순서대로 찾아, 자리표시자에 맞춘 값을 넣은 번역문을 돌려줍니다. 맞는 패턴이 없으면 undefined입니다.
export function matchPattern(patterns: readonly Pattern[], source: string): string | undefined {
  for (const pattern of patterns) {
    const groups = pattern.regex.exec(source)?.groups
    if (groups !== undefined) return pattern.translated.replace(PLACEHOLDER, (_, name: string) => groups[name] ?? '')
  }
  return undefined
}

// 내보내기 파일에 넣을 patterns 섹션을 만듭니다. 원문 패턴과 번역문을 번역표에 적힌 순서대로 담습니다.
export function patternSection(table: PatternTable): Record<Kind, Record<string, string>> {
  const section: Record<Kind, Record<string, string>> = { commands: {}, config: {} }
  for (const kind of PATTERN_KINDS) {
    for (const pattern of table[kind]) section[kind][pattern.source] = pattern.translated
  }
  return section
}

// 원문 패턴과 번역문이 규칙에 맞으면 정규식을 만들어 패턴을 돌려주고, 맞지 않으면 undefined를 돌려줍니다.
// 원문에는 자리표시자가 하나 이상 있고 이름이 겹치지 않아야 하며, 번역문에는 그 자리표시자가 각각 한 번씩만 있어야 합니다.
function makePattern(source: string, translated: string): Pattern | undefined {
  const names = placeholdersOf(source)
  if (names.length === 0 || new Set(names).size !== names.length) return undefined
  const used = placeholdersOf(translated)
  if (used.length !== names.length || !names.every((name) => used.includes(name))) return undefined
  let body = ''
  let last = 0
  for (const match of source.matchAll(PLACEHOLDER)) {
    body += escapeRegExp(source.slice(last, match.index)) + `(?<${match[1] ?? ''}>.+?)`
    last = match.index + match[0].length
  }
  body += escapeRegExp(source.slice(last))
  return { source, translated, regex: new RegExp(`^${body}$`) }
}

// 문구에 든 자리표시자의 이름을 나오는 순서대로 돌려줍니다.
function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '')
}

// 정규식에서 특별한 뜻이 있는 문자를 글자 그대로 비교하도록 바꿉니다.
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 값이 배열이 아닌 객체인지 확인합니다.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
