# korean-ui 번역 지침

이 문서는 Claude Code의 명령어 설명과 /config 설정 항목을 한국어로 번역할 때 따르는 지침입니다. Haiku에게 보내는 번역 지시문이면서, 기본 번역표를 검수하는 기준입니다.

## 원문 충실성

- 원문에 없는 설명이나 단어를 덧붙이지 않습니다.
- 원문에 있는 정보를 빼지 않습니다.
- 원문의 의미와 순서를 최대한 유지하고, 다른 표현으로 크게 바꾸어 쓰지 않습니다.
- 원문의 문장부호 구조를 유지합니다. 괄호는 그대로 두고, 세미콜론으로 이어진 부분은 문장을 나누어 옮깁니다.
- 엠대시(—)는 그대로 쓰지 않고, 문장을 나누거나 쉼표, 콜론으로 옮깁니다.
- 원문보다 길게 늘이지 않습니다.

## 뜻이 정확하게 읽히도록

- 단어는 사전의 첫 번째 뜻이 아니라 문맥에 맞는 뜻으로 옮깁니다. (예: committing nontrivial changes → 간단하지 않은 변경을 커밋하기, the pending changes on the current branch → 현재 브랜치에서 아직 병합되지 않은 변경 사항, Detach from this background session → 이 백그라운드 세션에서 나갑니다)
- 누가 무엇을 하는지가 원문과 같게 읽히도록 옮깁니다. (예: Unattended commands from cloud sessions on this computer → 클라우드 세션이 이 컴퓨터에서 무인으로 실행하는 명령)
- 원문이 기능 설명이 아니라 사용자에게 주는 안내이면, 명령어가 그 일을 하는 것처럼 읽히지 않게 옮깁니다. (예: (removed) Ask Claude to create/manage subagents, or edit .claude/agents/ → (제거됨) 서브에이전트를 만들거나 관리하려면 Claude에게 요청하거나 .claude/agents/를 편집합니다)
- 꾸미는 말은 꾸밈을 받는 말 바로 앞에 둡니다. 꾸미는 범위가 둘 이상으로 읽히면 어순을 바꿉니다. (예: Activate pending plugin changes in the current session → 대기 중인 플러그인 변경 사항을 현재 세션에 적용합니다)

## 문체

- 명령어와 스킬의 설명은 문장형(~합니다)으로 번역합니다.
- /config 항목 이름은 원문의 형태를 따릅니다. 원문이 명사이면 명사로 번역합니다. 명사형으로 끝내더라도 말을 지나치게 줄이지 않습니다. (예: Continue automatically at usage limit → 사용량 한도 도달 시 자동으로 계속 진행)
- 번역문은 한 줄로 씁니다. 줄바꿈을 넣지 않습니다.
- 영어의 and/or는 "및/또는"으로 옮기지 않고, "A, B 또는 둘 다"처럼 자연스러운 한국어로 옮깁니다.

## 자연스러운 문장

- "~을 사용하여", "~을 통해", "선택 사항인 ~", "필수 ~" 같은 번역투를 쓰지 않습니다. (예: Use this skill to configure the Claude Code harness via settings.json → settings.json으로 Claude Code 하네스를 설정할 때 이 스킬을 사용합니다, optional break reminders → 필요하면 켤 수 있는 휴식 알림, the required commit workflow → 정해진 커밋 워크플로우)
- 한 문장 안에서 같은 말을 되풀이하지 않습니다. (예: run again to turn both back on → 다시 실행하면 둘 다 켜집니다)
- 명사 앞에 꾸밈말을 쉼표로 길게 쌓지 않고, 문장을 나눕니다. (예: Produces visualizations that read as one system — elegant, accessible, consistent in light and dark → 하나의 체계로 보이는 시각화를 만듭니다. 우아하고 접근성이 좋으며, 라이트 테마와 다크 테마에서 모두 일관됩니다)
- 명사와 어울리는 동사를 씁니다. (예: Turn on iTerm2 clipboard access → iTerm2 클립보드 접근 권한을 허용합니다, Ask a side question → 따로 질문합니다)
- 주어와 서술어가 어울리게 씁니다. "페이지가 데이터를 읽기"처럼 주격 조사 뒤에 명사형(~하기)을 이어 쓰지 않습니다. (예: such as the page reading live or connected data → 실시간 데이터나 연결된 데이터 읽기)

## 그대로 둘 것

- 명령어 이름(/resume 등), 옵션(--flag 등), 파일 이름과 경로, 코드 식별자, 백틱(`)으로 감싼 코드
- 제품과 서비스 이름: Claude Code, Claude, MCP, GitHub, IDE 이름 등

## 맥락 정보

- 항목에 name(명령어 이름 또는 설정 항목의 key)과 plugin(제공하는 플러그인)이 함께 올 수 있습니다. 짧거나 모호한 문구의 뜻을 짐작하는 데만 쓰고, 번역문에는 넣지 않습니다.

## 용어집

같은 용어는 항상 같은 말로 번역합니다.

| 영어 | 한국어 |
|---|---|
| session | 세션 |
| context | 컨텍스트 |
| plugin | 플러그인 |
| skill | 스킬 |
| permission | 권한 |
| model | 모델 |
| subagent | 서브에이전트 |
| directory | 디렉터리 |
| repository | 저장소 |
| artifact | 아티팩트 |
| workflow | 워크플로우 |
| worktree | 워크트리 |
| status line | 상태 줄 |
| plan mode | 플랜 모드 |
| plan (요금제) | 요금제 |
| limit | 한도 |
| access | 접근 권한 |
| harness | 하네스 |
| changes | 변경 사항 |
| thinking mode | 사고 모드 |
| verbose | 상세 |
| toggle | 켜거나 끕니다 (패널이나 창은 열거나 닫습니다) |
| view | 확인합니다 |
| browse | 살펴봅니다 |
| effort | effort (그대로 둡니다) |
| pull request | PR |
| brief (모드 이름) | brief (그대로 둡니다) |

## 예시

- 원문: Start a new session with empty context; previous session stays on disk (resumable with /resume)
- 번역: 빈 컨텍스트로 새 세션을 시작합니다. 이전 세션은 디스크에 유지됩니다(/resume으로 이어서 진행할 수 있습니다)
- 원문: Restore the code and/or conversation to a previous point
- 번역: 코드, 대화 또는 둘 다를 이전 시점으로 복원합니다
