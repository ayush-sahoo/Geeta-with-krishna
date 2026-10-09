# Project skills

## linkedin-agent (li-*)

Eleven LinkedIn skills vendored from
[avi691/linkedin-agent-skill](https://github.com/avi691/linkedin-agent-skill)
at commit `e4ec4fb`. MIT licensed by Jake Schincariol and Avi Grondin — see
`LICENSE-linkedin-agent`.

| skill | what it does |
| --- | --- |
| `/li-post` | one idea -> a post, with three hook options from 21 formulas |
| `/li-comment` | comments on other people's posts, nine comment types |
| `/li-reply` | triages and answers the comments on your own posts |
| `/li-profile` | scores your profile out of 100, rewrites what loses points |
| `/li-plan` | the week: what to post, when, and who to engage with |
| `/li-human` | strips the AI fingerprint and scores the draft (runs locally) |
| `/li-carousel` | slide-by-slide document posts |
| `/li-repurpose` | a video, newsletter or transcript -> a week of posts |
| `/li-dm` | connection notes and follow-ups |
| `/li-inbox` | sorts DMs into leads, recruiters, peers, spam |
| `/li-audit` | reads past-post analytics and says what to stop doing |

### First-time setup

Fill in the voice profile or every draft reads generic:

```bash
mkdir -p ~/.claude/linkedin
cp .claude/linkedin/voice.template.md ~/.claude/linkedin/voice.md
```

Then edit it, or paste three of your own posts into Claude and say "write my
voice.md from these". The skills also write `~/.claude/linkedin/plan.md` and
`log.md` there, outside the repo, so nothing personal gets committed.

### The humanizer

`li-human` ships two dependency-free Python scripts that run locally — no
network calls, nothing uploaded:

```bash
python3 .claude/skills/li-human/humanize.py draft.txt -o clean.txt --report
python3 .claude/skills/li-human/detect.py draft.txt clean.txt
```

`humanize.py` removes invisible characters, normalizes em dashes and curly
quotes, and swaps ~113 stock phrases from `slop.json`. `detect.py` scores five
local heuristics (burstiness, specificity, slop density, fingerprint, voice)
and exits non-zero below PASS. These are heuristics, not calls to GPTZero,
Originality or Turnitin, and they promise no verdict from those services.

### What these skills do not do

They never post to LinkedIn. There is no open posting API for personal
profiles, and automating it violates LinkedIn's User Agreement. Every skill
produces copy you paste yourself.
