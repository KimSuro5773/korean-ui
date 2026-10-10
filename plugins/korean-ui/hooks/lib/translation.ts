// 번역 사전을 읽고, 찾고, 합치는 함수들입니다.
// Claude Code API($)를 쓰지 않으므로 Claude Code 없이 테스트할 수 있습니다.

// 번역할 문구의 종류입니다. commands는 명령어 설명, config는 /config 항목입니다.
export type Kind = 'commands' | 'config'
export const KINDS: readonly Kind[] = ['commands', 'config']

// 항목을 누가 제공했는지 나타냅니다. builtin은 Claude Code, others는 다른 플러그인, self는 이 플러그인입니다.
export type Category = 'builtin' | 'others' | 'self'

// 영어 원문을 키로, 한국어 번역문을 값으로 저장합니다. 명령어 설명과 /config 항목을 나누어 저장합니다.
export type Dictionary = Record<Kind, Record<string, string>>

// 번역문을 찾는 세 계층입니다. overrides는 요청으로 고친 번역, bundled는 기본 번역표, user는 자동 번역입니다.
// 번역문은 이 순서로 찾습니다.
export type Layers = { overrides: Dictionary; bundled: Dictionary; user: Dictionary }

// /config에서 켜고 끄는 세 항목의 값입니다.
export type Settings = {
  translateBuiltin: boolean
  translateOthers: boolean
  notifyUntranslated: boolean
}

// 화면에 표시된 영어 원문 하나의 기록입니다. names는 그 원문을 쓰는 명령어 이름('/commit')이나 /config 항목의 key이고,
// providers는 그 원문을 제공하는 제공자의 표시 이름입니다.
export type SeenEntry = { category: Category; names: Set<string>; providers: Set<string> }

// 화면에 표시된 영어 원문과, 그 원문을 누가 어떤 이름으로 제공했는지 기록합니다.
export type Seen = Record<Kind, Map<string, SeenEntry>>

// 번역 명령어가 번역한 개수와 실패한 개수입니다. newlySkipped는 실패한 원문 중 이번 실행에서 실패 횟수가 3 이상이 된 수입니다.
export type Counts = { commands: number; config: number; failed: number; newlySkipped: number }

// 내보내기 결과입니다. json은 파일 내용, missing은 번역문이 없는 기본 항목 수, builtinCount는 확인한 기본 항목 수입니다.
export type ExportResult = { json: string; missing: number; builtinCount: number }

// 사용자에게 보여 주는 문구입니다.
export const MESSAGES = {
  commandDescription: '번역되지 않은 명령어 설명과 설정 항목을 Haiku로 번역합니다',
  nothing: '번역할 문구가 없습니다.',
  noCategory: "번역 항목이 모두 꺼져 있습니다. /config에서 '기본 항목 번역'이나 '다른 플러그인과 스킬 번역'을 켜 주세요.",
  othersHint: '다른 플러그인과 스킬도 번역하려면 /config에서 해당 항목을 켠 뒤 다시 실행하세요.',
  usage: '사용법: /korean-ui-translate를 인자 없이 실행하면 번역되지 않은 문구를 번역합니다.',
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
  progress: (done: number, total: number) => `번역 중 ${done}/${total}`,
  failedHeader: '실패한 문구:',
  reasons: {
    missing: '응답에 번역문이 없음',
    empty: '빈 번역문',
    multiline: '번역문이 여러 줄',
    token: (tokens: readonly string[]) => `그대로 둘 부분이 빠짐: ${tokens.join(', ')}`,
    unparsable: '응답을 읽을 수 없음',
    emptyReply: '응답이 비어 있음',
  },
  skipped: (count: number) => `이번 실행에서는 3번 실패한 문구 ${count}개를 건너뛰었습니다. 플러그인이 업데이트되면 다시 번역합니다.`,
  resetDescription: 'Haiku로 번역해서 저장한 문구를 모두 지웁니다',
  resetNothing: '지울 번역이 없습니다.',
  resetChoices: { remove: '지우기', retranslate: '지우고 다시 번역', cancel: '취소' },
  resetQuestion: (translations: number, skipped: number): string => {
    if (translations === 0) return `3번 실패한 문구의 기록 ${skipped}개를 지워서 다음 번역 때 다시 시도하게 할까요?`
    const lead = `기본 번역표의 번역은 그대로 남습니다. Haiku로 번역한 문구 ${translations}개`
    if (skipped === 0) return `${lead}를 모두 지울까요?`
    return `${lead}와 3번 실패한 문구의 기록 ${skipped}개를 모두 지울까요?`
  },
  resetDone: (translations: number, skipped: number): string => {
    const retry = '건너뛰던 문구는 다음 번역 때 다시 시도합니다.'
    if (skipped === 0) return translations > 0 ? `Haiku로 번역한 문구 ${translations}개를 지웠습니다.` : ''
    if (translations === 0) return `3번 실패한 문구의 기록 ${skipped}개를 지웠습니다. ${retry}`
    return `Haiku로 번역한 문구 ${translations}개와 3번 실패한 문구의 기록 ${skipped}개를 지웠습니다. ${retry}`
  },
  resetFailuresKept: (reason: string) => `3번 실패한 문구의 기록은 지우지 못해서 다음에도 건너뜁니다. 원인: ${reason}.`,
  resetRetranslateHint: '다시 번역하려면 /korean-ui-translate를 실행하세요.',
  resetCanceled: '취소했습니다. 번역은 그대로 남아 있습니다.',
  resetFailed: (reason: string) => `번역을 지우지 못했습니다. 원인: ${reason}. 기존 번역은 그대로 남아 있습니다.`,
} as const

// 빈 번역 사전을 만듭니다.
export function emptyDictionary(): Dictionary {
  return { commands: {}, config: {} }
}

// 번역 사전에 든 번역문의 수를 셉니다.
export function countEntries(dictionary: Dictionary): number {
  return KINDS.reduce((sum, kind) => sum + Object.keys(dictionary[kind]).length, 0)
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

// Claude Code 기본 항목의 제공자를 사용자에게 보여 줄 때 쓰는 이름입니다.
export const BUILTIN_PROVIDER = 'claude-code'

// 제공자를 사용자에게 보여 줄 이름으로 바꿉니다. Claude Code는 'claude-code', 다른 플러그인은 '@마켓플레이스'를 뗀 이름입니다.
export function providerLabel(providerPlugin: string): string {
  return providerPlugin === 'engine' ? BUILTIN_PROVIDER : pluginBase(providerPlugin)
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

// 영어 원문의 번역문을 찾습니다. 고친 번역을 먼저 찾고, 없으면 기본 번역표, 그다음 자동 번역을 찾습니다.
export function lookup(layers: Layers, kind: Kind, source: string): string | undefined {
  for (const dictionary of [layers.overrides, layers.bundled, layers.user]) {
    if (Object.hasOwn(dictionary[kind], source)) return dictionary[kind][source]
  }
  return undefined
}

// 화면에 표시된 원문을 기록합니다. Claude Code도 같은 원문을 쓰면 Claude Code 항목으로 남겨서 내보내기에서 빠지지 않게 합니다.
// 같은 원문을 여러 명령어나 여러 제공자가 쓰면 이름과 제공자를 모두 모읍니다.
export function recordSeen(seen: Seen, kind: Kind, source: string, category: Category, name: string, provider: string): void {
  const entry = seen[kind].get(source)
  if (entry === undefined) {
    seen[kind].set(source, { category, names: new Set([name]), providers: new Set([provider]) })
    return
  }
  if (entry.category !== 'builtin') entry.category = category
  entry.names.add(name)
  entry.providers.add(provider)
}

// 번역하도록 켜 둔 항목 중에서 아직 번역문이 없는 원문을 정렬해서 돌려줍니다.
export function untranslated(seen: Seen, settings: Settings, layers: Layers): Record<Kind, string[]> {
  const result: Record<Kind, string[]> = { commands: [], config: [] }
  for (const kind of KINDS) {
    for (const [source, entry] of seen[kind]) {
      if (isEnabled(entry.category, settings) && lookup(layers, kind, source) === undefined) result[kind].push(source)
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
// 기본 항목에 고친 번역이 있으면 그 번역을 넣어서, 요청으로 고친 번역을 기본 번역표에 반영할 수 있게 합니다.
export function buildExport(seen: Seen, layers: Layers): ExportResult {
  const out = emptyDictionary()
  let missing = 0
  let builtinCount = 0
  for (const kind of KINDS) {
    const merged: Record<string, string> = { ...layers.bundled[kind] }
    for (const [source, entry] of seen[kind]) {
      if (entry.category !== 'builtin') continue
      builtinCount += 1
      const translated = lookup(layers, kind, source)
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

// 저장소에서 읽은 알림 기록을 문자열 목록으로 바꿉니다. 문자열이 아닌 값은 버립니다.
export function parseNotified(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
}

// 오류에서 사용자에게 보여 줄 메시지를 꺼냅니다.
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 번역 명령어의 실행 결과를 한 문장으로 요약합니다. 실패한 원문이 있으면 다시 번역할지, 다음부터 건너뛸지 함께 알려 줍니다.
export function summaryText(counts: Counts): string {
  const done = `명령어 설명 ${counts.commands}개, 설정 항목 ${counts.config}개를 번역했습니다.`
  if (counts.failed === 0) return done
  if (counts.newlySkipped === 0) return `${done} 실패한 ${counts.failed}개는 다음에 실행할 때 다시 번역합니다.`
  if (counts.newlySkipped === counts.failed) return `${done} 실패한 ${counts.failed}개는 3번 실패해서 다음부터 건너뜁니다.`
  return `${done} 실패한 ${counts.failed}개 중 ${counts.newlySkipped}개는 3번 실패해서 다음부터 건너뛰고, 나머지는 다음에 실행할 때 다시 번역합니다.`
}

const FAILED_PREVIEW_LENGTH = 80

// 결과에 보여 줄 실패한 원문입니다. newlySkipped가 true이면 이번 실행에서 실패 횟수가 3 이상이 되어 다음부터 건너뜁니다.
export type FailedItem = Rejection & { newlySkipped?: boolean }

// 번역에 실패한 원문과 그 이유를 한 줄에 하나씩 보여 주는 문장을 만듭니다. 실패한 원문이 없으면 빈 문자열을 돌려줍니다.
export function failedListText(items: readonly FailedItem[]): string {
  if (items.length === 0) return ''
  const lines = items.map((item) => {
    const note = item.newlySkipped === true ? ', 3번째 실패' : ''
    return `- ${previewOf(item.source)} (${reasonText(item.reason)}${note})`
  })
  return `\n${MESSAGES.failedHeader}\n${lines.join('\n')}`
}

// 3번 실패해서 건너뛴 원문이 있으면 결과 끝에 붙일 문장을 만듭니다. 없으면 빈 문자열을 돌려줍니다.
export function skippedText(count: number): string {
  return count > 0 ? `\n${MESSAGES.skipped(count)}` : ''
}

// 결과에 보여 줄 원문을 80자에서 줄입니다.
function previewOf(source: string): string {
  return source.length > FAILED_PREVIEW_LENGTH ? `${source.slice(0, FAILED_PREVIEW_LENGTH)}…` : source
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

// Haiku에게 번역을 요청할 원문 하나입니다. names는 그 원문을 쓰는 명령어 이름이나 /config 항목의 key이고,
// providers는 그 원문을 제공하는 제공자의 표시 이름입니다.
export type PromptItem = { source: string; names: readonly string[]; providers: readonly string[] }

// 요청문에 넣는 이름과 제공자는 이 개수까지만 보냅니다.
const CONTEXT_LIMIT = 3

// 번역 요청문에서 name과 plugin이 무엇인지 알려 주는 문장입니다.
export const CONTEXT_HINT =
  'name은 이 문구가 붙은 명령어 이름 또는 설정 항목의 key이고, plugin은 그 항목을 제공하는 플러그인입니다. 뜻을 짐작하는 데만 쓰고 번역문에는 넣지 마세요.'

// 원문마다 화면에서 확인한 이름과 제공자를 붙여서 번역 요청 항목으로 만듭니다. 기록이 없는 원문은 이름과 제공자를 비워 둡니다.
export function promptItems(seen: Seen, kind: Kind, sources: readonly string[]): PromptItem[] {
  return sources.map((source) => {
    const entry = seen[kind].get(source)
    return { source, names: [...(entry?.names ?? [])], providers: [...(entry?.providers ?? [])] }
  })
}

// Haiku에게 보낼 번역 요청문을 만듭니다. 원문 대신 번호를 키로 쓰게 해서, 응답의 키가 원문과 어긋나는 문제를 막습니다.
// 원문에 그대로 둘 명령어, 옵션, 백틱 코드가 있으면 keep으로 함께 보냅니다. 응답을 검사할 때와 같은 목록입니다.
// 짧고 모호한 문구의 뜻을 짐작할 수 있도록, 이름과 제공자가 있으면 name과 plugin으로 함께 보냅니다.
export function buildPrompt(kind: Kind, batch: readonly PromptItem[]): string {
  const target = kind === 'commands' ? 'Claude Code의 명령어와 스킬 설명' : 'Claude Code의 /config 설정 항목 이름과 도움말'
  const items = batch.map((item, index) => {
    const keep = protectedTokens(item.source)
    return {
      id: String(index + 1),
      text: item.source,
      ...(keep.length > 0 ? { keep } : {}),
      ...(item.names.length > 0 ? { name: item.names.slice(0, CONTEXT_LIMIT).join(', ') } : {}),
      ...(item.providers.length > 0 ? { plugin: item.providers.slice(0, CONTEXT_LIMIT).join(', ') } : {}),
    }
  })
  return [
    `다음은 ${target}입니다. 번역 지침에 따라 각 항목의 text를 한국어로 번역하세요.`,
    'keep이 있는 항목은 keep의 문자열을 번역문에 그대로 넣으세요.',
    CONTEXT_HINT,
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

// 번역문을 받아들이지 않은 이유입니다. missing, empty, multiline, token은 원문 하나의 문제이고,
// unparsable과 empty-reply는 응답 전체를 읽지 못한 경우입니다.
export type RejectReason =
  | { code: 'missing' }
  | { code: 'empty' }
  | { code: 'multiline' }
  | { code: 'token'; tokens: string[] }
  | { code: 'unparsable' }
  | { code: 'empty-reply' }

// 받아들이지 않은 원문과 그 이유입니다.
export type Rejection = { source: string; reason: RejectReason }

// 응답을 검사한 결과입니다. accepted는 저장할 번역문, rejected는 받아들이지 않은 원문과 그 이유입니다.
export type BatchCheck = { accepted: Record<string, string>; rejected: Rejection[] }

// Haiku가 보낸 번역문을 검사합니다. 비어 있지 않은 한 줄이어야 하고, 원문의 명령어, 옵션, 백틱 코드가 모두 들어 있어야 합니다.
export function validateReply(batch: readonly string[], replyText: string): BatchCheck {
  const parsed = parseReply(replyText)
  if (parsed === undefined) return rejectAll(batch, { code: 'unparsable' })
  const accepted: Record<string, string> = {}
  const rejected: Rejection[] = []
  batch.forEach((source, index) => {
    const key = String(index + 1)
    const isPresent = Object.hasOwn(parsed, key)
    const value = isPresent ? parsed[key] : undefined
    const translated = typeof value === 'string' ? value.trim() : ''
    const reason: RejectReason | undefined = isPresent ? rejectionOf(source, translated) : { code: 'missing' }
    if (reason === undefined) accepted[source] = translated
    else rejected.push({ source, reason })
  })
  return { accepted, rejected }
}

// 번역문 하나를 검사해서 받아들이지 않을 이유를 돌려줍니다. 문제가 없으면 undefined를 돌려줍니다.
function rejectionOf(source: string, translated: string): RejectReason | undefined {
  if (translated === '') return { code: 'empty' }
  if (/[\r\n]/.test(translated)) return { code: 'multiline' }
  const lost = protectedTokens(source).filter((token) => !translated.includes(token))
  return lost.length > 0 ? { code: 'token', tokens: lost } : undefined
}

// 한 번에 보낸 원문을 모두 같은 이유로 받아들이지 않은 결과를 만듭니다.
export function rejectAll(batch: readonly string[], reason: RejectReason): BatchCheck {
  return { accepted: {}, rejected: batch.map((source) => ({ source, reason })) }
}

// 실패 이유를 결과에 표시할 문구로 바꿉니다.
export function reasonText(reason: RejectReason): string {
  switch (reason.code) {
    case 'missing':
      return MESSAGES.reasons.missing
    case 'empty':
      return MESSAGES.reasons.empty
    case 'multiline':
      return MESSAGES.reasons.multiline
    case 'token':
      return MESSAGES.reasons.token(reason.tokens)
    case 'unparsable':
      return MESSAGES.reasons.unparsable
    case 'empty-reply':
      return MESSAGES.reasons.emptyReply
  }
}

// 번역에 실패한 횟수의 기록입니다. counts의 키는 noticeKey와 같은 '종류:원문' 형식이고, version은 기록한 플러그인 버전입니다.
export type Failures = { version: string; counts: Record<string, number> }

// 이 횟수만큼 실패한 원문은 다음 실행부터 Haiku에게 보내지 않습니다.
export const SKIP_AFTER = 3

// plugin.json의 내용에서 버전을 꺼냅니다. JSON이 아니거나 버전이 없으면 undefined를 돌려줍니다.
export function versionOf(text: string): string | undefined {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return undefined
    const version = (value as Record<string, unknown>)['version']
    return typeof version === 'string' && version !== '' ? version : undefined
  } catch {
    return undefined
  }
}

// 저장소에서 읽은 실패 기록을 현재 버전의 기록으로 바꿉니다. 형식이 잘못되었거나 다른 버전에서 기록했으면 빈 기록을 돌려줍니다.
export function parseFailures(raw: unknown, version: string): Failures {
  const result: Failures = { version, counts: {} }
  if (typeof raw !== 'object' || raw === null) return result
  const record = raw as Record<string, unknown>
  const counts = record['counts']
  if (record['version'] !== version || typeof counts !== 'object' || counts === null || Array.isArray(counts)) return result
  for (const [key, value] of Object.entries(counts)) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) result.counts[key] = value
  }
  return result
}

// 3번 이상 실패해서 건너뛸 원문인지 확인합니다. 실패 기록을 쓰지 않을 때(failures가 undefined)는 건너뛰지 않습니다.
export function isSkipped(failures: Failures | undefined, kind: Kind, source: string): boolean {
  return (failures?.counts[noticeKey(kind, source)] ?? 0) >= SKIP_AFTER
}

// 3번 이상 실패해서 건너뛰는 원문의 수를 셉니다.
export function skippedCount(failures: Failures | undefined): number {
  return Object.values(failures?.counts ?? {}).filter((count) => count >= SKIP_AFTER).length
}

// 번역할 원문에서 건너뛸 원문을 뺍니다. skipped는 뺀 원문의 수입니다.
export function splitSkipped(
  pending: Readonly<Record<Kind, string[]>>,
  failures: Failures | undefined,
): { pending: Record<Kind, string[]>; skipped: number } {
  const result: Record<Kind, string[]> = { commands: [], config: [] }
  let skipped = 0
  for (const kind of KINDS) {
    for (const source of pending[kind]) {
      if (isSkipped(failures, kind, source)) skipped += 1
      else result[kind].push(source)
    }
  }
  return { pending: result, skipped }
}

// 응답 전체를 읽지 못해서 생긴 실패인지 확인합니다. 이런 실패는 어느 원문 때문인지 알 수 없습니다.
function isWholeReply(reason: RejectReason): boolean {
  return reason.code === 'unparsable' || reason.code === 'empty-reply'
}

// 실패 횟수에 더할 원문을 고릅니다. 원문 하나의 문제로 거부된 원문은 모두 고르고,
// 응답 전체를 읽지 못한 경우는 한 번에 보낸 원문이 하나뿐일 때만 고릅니다.
export function countedFailures(sentCount: number, rejected: readonly Rejection[]): string[] {
  return rejected.filter((item) => !isWholeReply(item.reason) || sentCount === 1).map((item) => item.source)
}

// 실패 기록에 이번 결과를 반영한 사본을 만듭니다. 번역에 성공한 원문은 횟수를 지우고, 실패로 센 원문은 1을 더합니다.
export function withFailures(
  failures: Failures,
  kind: Kind,
  succeeded: readonly string[],
  counted: readonly string[],
): Failures {
  const counts = { ...failures.counts }
  for (const source of succeeded) delete counts[noticeKey(kind, source)]
  for (const source of counted) {
    const key = noticeKey(kind, source)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return { version: failures.version, counts }
}

// 명령어 설명의 번역문으로 영어 원문을 찾는 표를 만듭니다. 같은 번역문이 여러 계층에 있으면 고친 번역, 기본 번역표,
// 자동 번역 순으로 그 계층의 원문을 씁니다.
// retired(이번 로드 동안 사전에서 빠진 번역문)도 넣되, 같은 번역문이 지금 사전에 있으면 지금 사전의 원문을 씁니다.
export function buildReverse(layers: Layers, retired: ReadonlyMap<string, string> = new Map()): Map<string, string> {
  const reverse = new Map<string, string>(retired)
  for (const dictionary of [layers.user, layers.bundled, layers.overrides]) {
    for (const [source, translated] of Object.entries(dictionary.commands)) reverse.set(translated, source)
  }
  return reverse
}

// 명령어 이름마다, 그 명령어의 번역문으로만 영어 원문을 찾는 표를 만듭니다.
// described는 command.describe에서 받은 명령어 이름과 영어 설명입니다. 다른 명령어와 번역문이 같아도 자기 원문을 찾게 합니다.
// 그 명령어의 원문에 대한 지운 번역문(retired)도 넣습니다.
export function buildNamedReverse(
  described: ReadonlyMap<string, string>,
  layers: Layers,
  retired: ReadonlyMap<string, string> = new Map(),
): Map<string, Map<string, string>> {
  const named = new Map<string, Map<string, string>>()
  for (const [name, source] of described) {
    const { base } = splitState(source)
    const reverse = new Map<string, string>()
    for (const [translated, retiredSource] of retired) {
      if (retiredSource === base) reverse.set(translated, base)
    }
    for (const dictionary of [layers.user, layers.bundled, layers.overrides]) {
      const translated = dictionary.commands[base]
      if (Object.hasOwn(dictionary.commands, base) && translated !== undefined) reverse.set(translated, base)
    }
    named.set(name, reverse)
  }
  return named
}

// 이번 로드 동안 자동 번역이나 고친 번역에서 빠지거나 다른 번역으로 바뀐 명령어 설명의 이전 번역문입니다. 키는 번역문, 값은 영어 원문입니다.
// Claude Code가 이전에 만든 스킬 목록을 다시 보내도 영어 원문으로 되돌릴 수 있도록 메모리에만 둡니다.
export type Retired = Map<string, string>

// 사전이 바뀌기 전과 후를 비교해서, 빠지거나 다른 번역으로 바뀐 명령어 설명의 이전 번역문을 retired에 더합니다.
export function retireRemoved(retired: Retired, before: Dictionary, after: Dictionary): void {
  for (const [source, translated] of Object.entries(before.commands)) {
    if (after.commands[source] !== translated) retired.set(translated, source)
  }
}

const SHOWN_STATE = /^(.*)\(현재 (.+)\)$/
const WHEN_TO_USE_SEPARATOR = ' - '

// 화면에 표시한 번역문이면 영어 원문을 돌려줍니다. 끝이 …로 잘렸거나 (현재 …)가 붙은 번역문,
// 스킬 목록에서 뒤에 ' - when_to_use'가 붙은 번역문도 원문을 찾습니다.
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
  return originalWithSuffix(shown, reverse)
}

// 스킬 목록에서 설명 뒤에 ' - when_to_use'가 붙은 줄의 앞부분이 번역문이면, 그 부분만 영어 원문으로 바꾼 문구를 돌려줍니다.
// 여러 번역문이 맞으면 가장 긴 번역문을 고릅니다.
function originalWithSuffix(shown: string, reverse: ReadonlyMap<string, string>): string | undefined {
  let matched: string | undefined
  for (const translated of reverse.keys()) {
    const isLonger = matched === undefined || translated.length > matched.length
    if (isLonger && shown.startsWith(`${translated}${WHEN_TO_USE_SEPARATOR}`)) matched = translated
  }
  if (matched === undefined) return undefined
  return `${reverse.get(matched) ?? ''}${shown.slice(matched.length)}`
}

// 스킬 목록을 되돌린 결과입니다. restored는 되돌린 줄 수이고, 그중 byName은 명령어 이름으로 원문을 찾은 줄 수입니다.
// leftover는 되돌리지 못하고 남은 번역문 수입니다.
export type ListingRestore = { text: string; restored: number; byName: number; leftover: number }

const LISTING_LINE = /^- (\S+): (.*)$/

// Claude에게 보내는 스킬 목록에서 화면용 번역문을 영어 원문으로 되돌립니다.
// 줄의 명령어 이름으로 그 명령어의 원문을 먼저 찾고, 찾지 못하면 사전 전체에서 찾습니다.
// 되돌린 뒤에도 번역문이 남아 있으면 목록 형식이 바뀐 것이므로, 남은 개수를 함께 알려 줍니다.
export function restoreListing(
  text: string,
  reverse: ReadonlyMap<string, string>,
  named: ReadonlyMap<string, ReadonlyMap<string, string>>,
): ListingRestore {
  let restored = 0
  let byName = 0
  const lines = text.split('\n').map((line) => {
    const match = LISTING_LINE.exec(line)
    if (match === null) return line
    const shown = match[2] ?? ''
    const own = named.get(match[1] ?? '')
    const fromOwn = own === undefined ? undefined : originalOf(shown, own)
    const original = fromOwn ?? originalOf(shown, reverse)
    if (original === undefined) return line
    restored += 1
    if (fromOwn !== undefined) byName += 1
    return `- ${match[1] ?? ''}: ${original}`
  })
  const result = lines.join('\n')
  const leftover = [...reverse.keys()].filter((translated) => result.includes(translated)).length
  return { text: result, restored, byName, leftover }
}
