// 번역 사전을 읽고, 찾고, 합치는 함수들입니다.
// Claude Code API($)를 쓰지 않으므로 Claude Code 없이 테스트할 수 있습니다.

// 번역할 문구의 종류입니다. commands는 명령어 설명, config는 /config 항목입니다.
export type Kind = 'commands' | 'config'
export const KINDS: readonly Kind[] = ['commands', 'config']

// 항목을 누가 제공했는지 나타냅니다. builtin은 Claude Code, others는 다른 플러그인, self는 이 플러그인입니다.
export type Category = 'builtin' | 'others' | 'self'

// 영어 원문을 키로, 한국어 번역문을 값으로 저장합니다. 명령어 설명과 /config 항목을 나누어 저장합니다.
export type Dictionary = Record<Kind, Record<string, string>>

// /config에서 켜고 끄는 세 항목의 값입니다.
export type Settings = {
  translateBuiltin: boolean
  translateOthers: boolean
  notifyUntranslated: boolean
}

// 화면에 표시된 영어 원문과, 그 원문을 누가 제공했는지 기록합니다.
export type Seen = Record<Kind, Map<string, Category>>

// 번역 명령어가 번역한 개수와 실패한 개수입니다.
export type Counts = { commands: number; config: number; failed: number }

// 내보내기 결과입니다. json은 파일 내용, missing은 번역문이 없는 기본 항목 수, builtinCount는 확인한 기본 항목 수입니다.
export type ExportResult = { json: string; missing: number; builtinCount: number }

// 사용자에게 보여 주는 문구입니다.
export const MESSAGES = {
  commandDescription: '번역되지 않은 명령어 설명과 설정 항목을 Haiku로 번역합니다',
  nothing: '번역할 문구가 없습니다.',
  noCategory: "번역 항목이 모두 꺼져 있습니다. /config에서 '기본 항목 번역'이나 '다른 플러그인과 스킬 번역'을 켜 주세요.",
  othersHint: '다른 플러그인과 스킬도 번역하려면 /config에서 해당 항목을 켠 뒤 다시 실행하세요.',
  usage:
    '사용법: /korean-ui-translate는 번역되지 않은 문구를 번역하고, /korean-ui-translate export는 기본 항목의 번역을 파일로 내보냅니다.',
  exportNothingSeen:
    '아직 확인한 기본 항목이 없어서 내보내지 않았습니다. 입력창에 /를 입력해 명령어 목록을 한 번 연 뒤 다시 실행하세요.',
  guideFailed: (reason: string) =>
    `번역 지침 파일(locales/ko-guide.md)을 읽지 못해서 번역을 시작하지 않았습니다. 원인: ${reason}`,
  modelFailed: (reason: string) =>
    `Haiku 호출에 실패해서 번역을 중단했습니다. 원인: ${reason}. 이미 저장한 번역은 그대로 유지됩니다.`,
  storeFailed: (reason: string) =>
    `번역 결과를 저장하지 못해서 번역을 중단했습니다. 원인: ${reason}. 기존 번역 사전은 그대로 유지됩니다.`,
  exported: (path: string, missing: number) =>
    `기본 항목의 번역을 ${path}에 저장했습니다. 번역문이 없는 기본 항목은 ${missing}개입니다.`,
  exportFailed: (reason: string, path: string) => `내보내기 파일을 저장하지 못했습니다. 원인: ${reason}. 저장하려던 경로: ${path}`,
  notice: (count: number) => `번역되지 않은 문구가 ${count}개 있습니다. /korean-ui-translate를 실행하면 번역합니다.`,
  failedHeader: '실패한 문구:',
} as const

// 빈 번역 사전을 만듭니다.
export function emptyDictionary(): Dictionary {
  return { commands: {}, config: {} }
}

// 화면에 표시된 원문을 기록할 빈 목록을 만듭니다.
export function emptySeen(): Seen {
  return { commands: new Map(), config: new Map() }
}

// /config에서 고른 값을 읽습니다. 값이 없으면 plugin.json의 기본값을 씁니다.
export function readSettings(options: Readonly<Record<string, unknown>>): Settings {
  return {
    translateBuiltin: options['translate_builtin'] !== false,
    translateOthers: options['translate_others'] === true,
    notifyUntranslated: options['notify_untranslated'] !== false,
  }
}

// 파일이나 저장소에서 읽은 값을 번역 사전으로 바꿉니다. 형식이 잘못된 항목은 버립니다.
export function parseDictionary(raw: unknown): Dictionary {
  const result = emptyDictionary()
  if (typeof raw !== 'object' || raw === null) return result
  for (const kind of KINDS) {
    const section: unknown = (raw as Record<string, unknown>)[kind]
    if (typeof section !== 'object' || section === null || Array.isArray(section)) continue
    for (const [source, translated] of Object.entries(section)) {
      if (typeof translated === 'string' && translated.trim() !== '') result[kind][source] = translated
    }
  }
  return result
}

// 항목을 Claude Code, 다른 플러그인, 이 플러그인 중 누가 제공했는지 판별합니다.
export function categoryOf(providerPlugin: string, selfName: string): Category {
  if (providerPlugin === 'engine') return 'builtin'
  if (pluginBase(providerPlugin) === pluginBase(selfName)) return 'self'
  return 'others'
}

// 'korean-ui@korean-ui'처럼 플러그인 이름 뒤에 붙은 '@마켓플레이스'를 뗍니다.
function pluginBase(name: string): string {
  const at = name.indexOf('@')
  return at === -1 ? name : name.slice(0, at)
}

const CURRENTLY = /^(.*\S) \(currently (.+)\)$/

// 설명 끝의 ' (currently Opus 5.5)' 같은 현재 상태 표시를 떼어 냅니다. 상태가 바뀌어도 같은 번역문을 찾기 위해서입니다.
export function splitState(source: string): { base: string; state: string | undefined } {
  const match = CURRENTLY.exec(source)
  if (match === null) return { base: source, state: undefined }
  return { base: match[1] ?? source, state: match[2] }
}

// 번역문 뒤에 떼어 냈던 현재 상태를 '(현재 Opus 5.5)'처럼 붙입니다.
export function withState(translated: string, state: string | undefined): string {
  return state === undefined ? translated : `${translated}(현재 ${state})`
}

// 이 항목을 번역하도록 /config에서 켜 두었는지 확인합니다.
export function isEnabled(category: Category, settings: Settings): boolean {
  if (category === 'builtin') return settings.translateBuiltin
  if (category === 'others') return settings.translateOthers
  return false
}

const HANGUL = /\p{Script=Hangul}/u

// 번역할 문구인지 확인합니다. 비어 있거나, 이미 한글이 들어 있거나, 여러 줄로 된 문구는 번역하지 않습니다.
// 여러 줄로 된 설명은 Claude가 스킬을 고를 때 쓰는 긴 지시문이어서 영어 원문 그대로 둡니다.
export function needsTranslation(source: string): boolean {
  return source.trim() !== '' && !HANGUL.test(source) && !/[\r\n]/.test(source)
}

// 영어 원문의 번역문을 찾습니다. 기본 번역표를 먼저 찾고, 없으면 사용자 번역 사전을 찾습니다.
export function lookup(bundled: Dictionary, user: Dictionary, kind: Kind, source: string): string | undefined {
  if (Object.hasOwn(bundled[kind], source)) return bundled[kind][source]
  if (Object.hasOwn(user[kind], source)) return user[kind][source]
  return undefined
}

// 화면에 표시된 원문을 기록합니다. Claude Code도 같은 원문을 쓰면 Claude Code 항목으로 남겨서 내보내기에서 빠지지 않게 합니다.
export function recordSeen(seen: Seen, kind: Kind, source: string, category: Category): void {
  if (seen[kind].get(source) === 'builtin') return
  seen[kind].set(source, category)
}

// 번역하도록 켜 둔 항목 중에서 아직 번역문이 없는 원문을 정렬해서 돌려줍니다.
export function untranslated(seen: Seen, settings: Settings, bundled: Dictionary, user: Dictionary): Record<Kind, string[]> {
  const result: Record<Kind, string[]> = { commands: [], config: [] }
  for (const kind of KINDS) {
    for (const [source, category] of seen[kind]) {
      if (isEnabled(category, settings) && lookup(bundled, user, kind, source) === undefined) result[kind].push(source)
    }
    result[kind].sort()
  }
  return result
}

// Haiku에 한 번에 보낼 원문을 50개, 6000자 이하로 나눕니다. 응답이 너무 길어져 잘리지 않게 하기 위해서입니다.
export function makeBatches(sources: readonly string[], maxItems = 50, maxChars = 6000): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let chars = 0
  for (const source of sources) {
    if (current.length > 0 && (current.length >= maxItems || chars + source.length > maxChars)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(source)
    chars += source.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

// 번역 사전에 새 번역문을 더한 사본을 만듭니다. 원래 사전은 바꾸지 않습니다.
export function withTranslations(dictionary: Dictionary, kind: Kind, additions: Readonly<Record<string, string>>): Dictionary {
  const next: Dictionary = { commands: { ...dictionary.commands }, config: { ...dictionary.config } }
  next[kind] = { ...next[kind], ...additions }
  return next
}

// 기존 기본 번역표에, 화면에서 확인한 Claude Code 기본 항목의 새 번역문을 더해 기본 번역표(ko.json)와 같은 형식의 JSON으로 만듭니다.
// /diff처럼 상황에 따라서만 나타나는 항목의 번역이 빠지지 않도록, 기존 기본 번역표의 항목은 모두 남깁니다.
export function buildExport(seen: Seen, bundled: Dictionary, user: Dictionary): ExportResult {
  const out = emptyDictionary()
  let missing = 0
  let builtinCount = 0
  for (const kind of KINDS) {
    const merged: Record<string, string> = { ...bundled[kind] }
    for (const [source, category] of seen[kind]) {
      if (category !== 'builtin') continue
      builtinCount += 1
      const translated = lookup(bundled, user, kind, source)
      if (translated === undefined) missing += 1
      else merged[source] = translated
    }
    for (const source of Object.keys(merged).sort()) out[kind][source] = merged[source] ?? ''
  }
  return { json: `${JSON.stringify(out, null, 2)}\n`, missing, builtinCount }
}

// 이미 알린 문구를 기록할 때 쓰는 키를 만듭니다. 명령어 설명과 /config 항목을 구분하려고 종류를 앞에 붙입니다.
export function noticeKey(kind: Kind, source: string): string {
  return `${kind}:${source}`
}

// 오류에서 사용자에게 보여 줄 메시지를 꺼냅니다.
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 번역 명령어의 실행 결과를 한 문장으로 요약합니다.
export function summaryText(counts: Counts): string {
  const done = `명령어 설명 ${counts.commands}개, 설정 항목 ${counts.config}개를 번역했습니다.`
  return counts.failed > 0 ? `${done} 실패한 ${counts.failed}개는 다음에 실행할 때 다시 번역합니다.` : done
}

const FAILED_PREVIEW_LENGTH = 80

// 번역에 실패한 원문을 한 줄에 하나씩 보여 주는 문장을 만듭니다. 긴 원문은 80자에서 줄이고, 실패한 원문이 없으면 빈 문자열을 돌려줍니다.
export function failedListText(failed: readonly string[]): string {
  if (failed.length === 0) return ''
  const lines = failed.map((source) =>
    source.length > FAILED_PREVIEW_LENGTH ? `- ${source.slice(0, FAILED_PREVIEW_LENGTH)}…` : `- ${source}`,
  )
  return `\n${MESSAGES.failedHeader}\n${lines.join('\n')}`
}

// 다른 플러그인과 스킬의 번역이 꺼져 있으면, 켜는 방법을 안내하는 문장을 덧붙입니다.
export function withOthersHint(text: string, settings: Settings): string {
  return settings.translateOthers ? text : `${text} ${MESSAGES.othersHint}`
}

// Haiku 호출이 실패한 원인을 사용자에게 보여 줄 한국어로 바꿉니다.
export function failureReason(reason: string, status: number | null | undefined): string {
  if (reason === 'api-error') return `API 오류(상태 코드 ${status ?? '없음'})`
  if (reason === 'aborted') return '호출이 중단됨'
  return reason
}

// Haiku에게 보낼 번역 요청문을 만듭니다. 원문 대신 번호를 키로 쓰게 해서, 응답의 키가 원문과 어긋나는 문제를 막습니다.
export function buildPrompt(kind: Kind, batch: readonly string[]): string {
  const target = kind === 'commands' ? 'Claude Code의 명령어와 스킬 설명' : 'Claude Code의 /config 설정 항목 이름과 도움말'
  const items = batch.map((text, index) => ({ id: String(index + 1), text }))
  return [
    `다음은 ${target}입니다. 번역 지침에 따라 각 항목의 text를 한국어로 번역하세요.`,
    '응답에는 id를 키로, 번역문을 값으로 하는 JSON 객체 하나만 출력하세요. 다른 설명은 쓰지 마세요.',
    '응답 형식의 예: {"1": "번역문", "2": "번역문"}',
    '',
    JSON.stringify(items, null, 2),
  ].join('\n')
}

const CODE_SPAN = /`[^`\n]+`/g
const SLASH_COMMAND = /(?<![\w./])\.?\/[a-z][a-z0-9:_-]*/gi
const OPTION_FLAG = /(?<![\w-])--[a-z][a-z0-9-]*/gi

// 번역문에도 그대로 남아 있어야 하는 백틱 코드, 명령어, 옵션을 원문에서 찾습니다.
export function protectedTokens(source: string): string[] {
  return [CODE_SPAN, SLASH_COMMAND, OPTION_FLAG].flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[0]))
}

// Haiku의 응답에서 JSON 객체를 꺼냅니다. 응답이 코드 블록으로 감싸여 있으면 감싼 표시를 벗겨 냅니다.
export function parseReply(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  const fenced = /^```[a-z]*\s*\n([\s\S]*?)\n?```$/i.exec(trimmed)
  const body = fenced?.[1] ?? trimmed
  try {
    const value: unknown = JSON.parse(body)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    return value as Record<string, unknown>
  } catch {
    return undefined
  }
}

// 응답을 검사한 결과입니다. accepted는 저장할 번역문, rejected는 다음에 다시 번역할 원문입니다.
export type BatchCheck = { accepted: Record<string, string>; rejected: string[] }

// Haiku가 보낸 번역문을 검사합니다. 비어 있지 않은 한 줄이어야 하고, 원문의 명령어, 옵션, 백틱 코드가 모두 들어 있어야 합니다.
export function validateReply(batch: readonly string[], replyText: string): BatchCheck {
  const parsed = parseReply(replyText)
  const accepted: Record<string, string> = {}
  const rejected: string[] = []
  batch.forEach((source, index) => {
    const key = String(index + 1)
    const value = parsed !== undefined && Object.hasOwn(parsed, key) ? parsed[key] : undefined
    const translated = typeof value === 'string' ? value.trim() : ''
    const isValid =
      translated !== '' && !/[\r\n]/.test(translated) && protectedTokens(source).every((token) => translated.includes(token))
    if (isValid) accepted[source] = translated
    else rejected.push(source)
  })
  return { accepted, rejected }
}

// 명령어 설명의 번역문으로 영어 원문을 찾는 표를 만듭니다. 같은 번역문이 두 사전에 있으면 기본 번역표의 원문을 씁니다.
export function buildReverse(bundled: Dictionary, user: Dictionary): Map<string, string> {
  const reverse = new Map<string, string>()
  for (const dictionary of [user, bundled]) {
    for (const [source, translated] of Object.entries(dictionary.commands)) reverse.set(translated, source)
  }
  return reverse
}

const SHOWN_STATE = /^(.*)\(현재 (.+)\)$/

// 화면에 표시한 번역문이면 영어 원문을 돌려줍니다. 끝이 …로 잘렸거나 (현재 …)가 붙은 번역문도 원문을 찾습니다.
export function originalOf(shown: string, reverse: ReadonlyMap<string, string>): string | undefined {
  const exact = reverse.get(shown)
  if (exact !== undefined) return exact
  const withCurrent = SHOWN_STATE.exec(shown)
  if (withCurrent !== null) {
    const base = reverse.get(withCurrent[1] ?? '')
    if (base !== undefined) return `${base} (currently ${withCurrent[2] ?? ''})`
  }
  if (shown.endsWith('…')) {
    const cut = shown.slice(0, -1).trimEnd()
    if (cut === '') return undefined
    for (const [translated, source] of reverse) {
      if (translated.startsWith(cut)) return source
    }
  }
  return undefined
}

// 스킬 목록을 되돌린 결과입니다. restored는 되돌린 줄 수, leftover는 되돌리지 못하고 남은 번역문 수입니다.
export type ListingRestore = { text: string; restored: number; leftover: number }

const LISTING_LINE = /^- (\S+): (.*)$/

// Claude에게 보내는 스킬 목록에서 화면용 번역문을 영어 원문으로 되돌립니다.
// 되돌린 뒤에도 번역문이 남아 있으면 목록 형식이 바뀐 것이므로, 남은 개수를 함께 알려 줍니다.
export function restoreListing(text: string, reverse: ReadonlyMap<string, string>): ListingRestore {
  let restored = 0
  const lines = text.split('\n').map((line) => {
    const match = LISTING_LINE.exec(line)
    if (match === null) return line
    const original = originalOf(match[2] ?? '', reverse)
    if (original === undefined) return line
    restored += 1
    return `- ${match[1] ?? ''}: ${original}`
  })
  const result = lines.join('\n')
  const leftover = [...reverse.keys()].filter((translated) => result.includes(translated)).length
  return { text: result, restored, leftover }
}
