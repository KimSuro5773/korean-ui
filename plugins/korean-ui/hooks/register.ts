import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'
import {
  type Counts,
  type Dictionary,
  type Kind,
  type Seen,
  type Settings,
  KINDS,
  MESSAGES,
  buildPrompt,
  buildReverse,
  categoryOf,
  emptyDictionary,
  emptySeen,
  failureReason,
  isEnabled,
  lookup,
  makeBatches,
  messageOf,
  needsTranslation,
  parseDictionary,
  readSettings,
  recordSeen,
  restoreListing,
  splitState,
  summaryText,
  untranslated,
  validateReply,
  withOthersHint,
  withState,
  withTranslations,
} from './lib/translation.ts'

const STORE_DICTIONARY = 'dictionary'

// 처음 필요할 때 한 번 읽어 두는 기본 번역표와 사용자 번역 사전입니다. user는 번역을 저장할 때마다 새 사전으로 바뀝니다.
type Loaded = {
  bundled: Dictionary
  user: Dictionary
}

// 플러그인이 한 번 로드된 동안 유지하는 상태입니다. /config 값을 바꾸면 플러그인이 다시 로드되어 새로 만들어집니다.
type State = {
  settings: Settings
  seen: Seen
  loading: Promise<Loaded> | undefined
}

// Haiku에 한 번 요청한 결과입니다. stopped가 있으면 그 이유를 보여 주고 번역을 멈춥니다.
type BatchOutcome = { saved: number; failed: number; stopped?: string }

// Claude Code가 플러그인을 불러올 때 부르는 함수입니다. 화면 문구를 바꾸는 이벤트 처리와 번역 명령어를 등록합니다.
export const register: Register = (on, options) => {
  const state: State = { settings: readSettings(options), seen: emptySeen(), loading: undefined }

  // 세션이 시작되면 번역 명령어를 등록합니다.
  // 다시 로드된 뒤에는 Claude Code가 저장해 둔 이전 표시 결과를 지워서, 바뀐 설정이 바로 반영되게 합니다.
  // 정적 검사가 등록한 명령어와 처리하는 명령어를 맞춰 볼 수 있도록, 명령어 이름은 상수 대신 그대로 적습니다.
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'korean-ui-translate', description: MESSAGES.commandDescription, argumentHint: '[export]' })
    } catch (error) {
      $.ui.log(`번역 명령어를 등록하지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    }
    $.ui.invalidate('command.describe')
    $.ui.invalidate('config.describe')
    return next(e)
  })

  // 메뉴와 /help에 표시할 명령어 설명을 한국어로 바꿉니다.
  on('command.describe', async ($, e, next) => {
    const description = await translateText($, state, 'commands', e.provider.plugin, e.description)
    return description === undefined ? next(e) : next({ ...e, description })
  })

  // Claude에게 보내기 직전의 스킬 목록에서 번역문을 영어 원문으로 되돌립니다.
  // 번역을 끈 뒤에도 Claude Code가 이전에 만든 목록을 다시 쓰는 경우가 있으므로, 설정과 관계없이 번역 사전을 기준으로 되돌립니다.
  on('prompt.attachment', { type: 'skill_listing' }, async ($, e, next) => {
    const loaded = await ensureLoaded($, state)
    const result = restoreListing(e.text, buildReverse(loaded.bundled, loaded.user))
    if (result.leftover > 0) {
      $.ui.log(`스킬 목록을 되돌린 뒤에도 번역문 ${result.leftover}개가 남아 있습니다. 목록 형식이 바뀌었을 수 있습니다.`, {
        to: 'debug',
      })
    }
    return result.restored > 0 ? next({ ...e, text: result.text }) : next(e)
  })

  // /config에 표시할 항목 이름과 도움말을 한국어로 바꿉니다.
  on('config.describe', async ($, e, next) => {
    const label = await translateText($, state, 'config', e.provider.plugin, e.label)
    const description =
      e.description === undefined ? undefined : await translateText($, state, 'config', e.provider.plugin, e.description)
    if (label === undefined && description === undefined) return next(e)
    return next({ ...e, label: label ?? e.label, description: description ?? e.description })
  })

  // /korean-ui-translate를 실행했을 때의 처리입니다. 인자가 없으면 번역하고, 알 수 없는 인자이면 사용법을 보여 줍니다.
  on('command.run', { command: 'korean-ui-translate' }, async ($, e) => {
    const argument = e.args.trim()
    if (argument === '') return { text: await runTranslate($, state) }
    return { text: MESSAGES.usage }
  })
}

// 화면에 표시할 문구의 번역문을 찾습니다. 번역하지 않는 문구이거나 번역문이 없으면 undefined를 돌려줍니다.
async function translateText(
  $: EngineInterface,
  state: State,
  kind: Kind,
  providerPlugin: string,
  source: string,
): Promise<string | undefined> {
  const category = categoryOf(providerPlugin, $.plugin.name)
  const { base, state: current } = splitState(source)
  if (category === 'self' || !needsTranslation(base)) return undefined
  recordSeen(state.seen, kind, base, category)
  if (!isEnabled(category, state.settings)) return undefined
  const loaded = await ensureLoaded($, state)
  const translated = lookup(loaded.bundled, loaded.user, kind, base)
  return translated === undefined ? undefined : withState(translated, current)
}

// 기본 번역표와 사용자 번역 사전을 처음 한 번만 읽고, 그다음부터는 읽어 둔 값을 씁니다.
function ensureLoaded($: EngineInterface, state: State): Promise<Loaded> {
  state.loading ??= loadAll($)
  return state.loading
}

// 기본 번역표와 사용자 번역 사전을 읽습니다.
async function loadAll($: EngineInterface): Promise<Loaded> {
  return { bundled: await readBundled($), user: await readUser($) }
}

// 플러그인 폴더의 기본 번역표를 읽습니다. 읽지 못하면 빈 사전으로 처리합니다.
async function readBundled($: EngineInterface): Promise<Dictionary> {
  try {
    return parseDictionary(JSON.parse(await $.fs.read(`${$.plugin.root}/locales/ko.json`)))
  } catch (error) {
    $.ui.log(`기본 번역표를 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    return emptyDictionary()
  }
}

// 저장소에서 사용자 번역 사전을 읽습니다. 읽지 못하면 빈 사전으로 처리합니다.
async function readUser($: EngineInterface): Promise<Dictionary> {
  try {
    return parseDictionary(await $.store.get(STORE_DICTIONARY))
  } catch (error) {
    $.ui.log(`사용자 번역 사전을 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    return emptyDictionary()
  }
}

// 명령어 목록과 /config 목록을 한 번 읽습니다. 아직 화면에 표시되지 않은 항목의 원문도 기록하기 위해서입니다.
async function collectSources($: EngineInterface): Promise<void> {
  try {
    await $.command.list()
  } catch (error) {
    $.ui.log(`명령어 목록을 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
  }
  try {
    await $.config.list()
  } catch (error) {
    $.ui.log(`설정 목록을 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
  }
}

// 번역문이 없는 문구를 Haiku로 번역해서 사용자 번역 사전에 저장하고, 결과를 요약한 문장을 돌려줍니다.
async function runTranslate($: EngineInterface, state: State): Promise<string> {
  if (!state.settings.translateBuiltin && !state.settings.translateOthers) return MESSAGES.noCategory
  await collectSources($)
  const loaded = await ensureLoaded($, state)
  const pending = untranslated(state.seen, state.settings, loaded.bundled, loaded.user)
  if (pending.commands.length + pending.config.length === 0) return withOthersHint(MESSAGES.nothing, state.settings)
  let guide: string
  try {
    guide = await $.fs.read(`${$.plugin.root}/locales/ko-guide.md`)
  } catch (error) {
    return MESSAGES.guideFailed(messageOf(error))
  }
  const counts: Counts = { commands: 0, config: 0, failed: 0 }
  try {
    for (const kind of KINDS) {
      for (const batch of makeBatches(pending[kind])) {
        const outcome = await translateBatch($, loaded, guide, kind, batch)
        if (outcome.stopped !== undefined) return `${summaryText(counts)} ${outcome.stopped}`
        counts[kind] += outcome.saved
        counts.failed += outcome.failed
      }
    }
    return withOthersHint(summaryText(counts), state.settings)
  } finally {
    $.ui.invalidate('command.describe')
    $.ui.invalidate('config.describe')
  }
}

// 원문 몇 개를 Haiku에 한 번 보내 번역하고, 검사를 통과한 번역문을 저장합니다.
async function translateBatch(
  $: EngineInterface,
  loaded: Loaded,
  guide: string,
  kind: Kind,
  batch: readonly string[],
): Promise<BatchOutcome> {
  let reply: ModelCompleteResult
  try {
    reply = await $.model.complete({ model: 'haiku', system: guide, prompt: buildPrompt(kind, batch), maxTokens: 8192 })
  } catch (error) {
    return { saved: 0, failed: 0, stopped: MESSAGES.modelFailed(messageOf(error)) }
  }
  if (!reply.isAnswered) {
    if (reply.reason === 'empty-reply') return { saved: 0, failed: batch.length }
    const status = 'status' in reply ? reply.status : null
    return { saved: 0, failed: 0, stopped: MESSAGES.modelFailed(failureReason(reply.reason, status)) }
  }
  const { accepted, rejected } = validateReply(batch, reply.text)
  const saved = Object.keys(accepted).length
  if (saved > 0) {
    try {
      await saveTranslations($, loaded, kind, accepted)
    } catch (error) {
      return { saved: 0, failed: 0, stopped: MESSAGES.storeFailed(messageOf(error)) }
    }
  }
  return { saved, failed: rejected.length }
}

// 번역문을 사용자 번역 사전에 저장합니다. 다른 세션이 그사이 저장한 번역을 지우지 않도록, 저장하기 직전에 저장소를 다시 읽어 합칩니다.
async function saveTranslations(
  $: EngineInterface,
  loaded: Loaded,
  kind: Kind,
  accepted: Readonly<Record<string, string>>,
): Promise<void> {
  const latest = parseDictionary(await $.store.get(STORE_DICTIONARY))
  const merged = withTranslations(latest, kind, accepted)
  await $.store.set(STORE_DICTIONARY, merged)
  loaded.user = merged
}
