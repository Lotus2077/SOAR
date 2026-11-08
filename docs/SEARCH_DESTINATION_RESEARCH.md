# Search destinations for owner decision 8

Date checked: 2026-11-08. Status: **research only; nothing here is Approved.** This note
answers [#48][i48] for owner decision 8 (review §5.10, item 8), which the owner records in
[#58][i58]. PLAN.md §4 reserves every new egress destination to the owner's explicit
approval, and nothing here approves one. No SearXNG instance was installed or run, no
search API or model was called, and no account was created, so nothing below is a
measurement. Every price, limit, default and term was read on 2026-11-08 from the
first-party page, terms or source file linked beside it. List prices exclude tax.
SearXNG defaults and code are cited at master commit `ac11e14` (2026-11-06), the commit
behind the newest container tag, `2026.11.6-ac11e14c5`. Terms are paraphrased, not quoted,
and none of this is legal advice.

## Answer in brief

**Gist.** SearXNG is the only zero-fee option and the only one whose receipt can bind each
query's exact bytes and engine set. But it gives every query, with the public IP of the
network it runs on, to each engine it forwards to; it ships with JSON output off; and its
scraped engines block or break without warning. Among keyed APIs, Brave (USD 5 per 1,000)
and Mojeek (about USD 2.7-4.0) are the GET options below USD 6.3. Brave's terms forbid
storing results and using them to evaluate or benchmark AI. Gemini grounding and Grounding
with Bing (USD 14) sit above USD 10.7 and are model tools that do not fit R2.

- **SearXNG, USD 0, fits every cap.** It runs as the official container
  (`docker.io/searxng/searxng`, built for linux/amd64, arm64 and arm/v7) on the Linux device,
  or under Docker Desktop or Podman on the Mac; the project documents no native macOS path.
  Loopback or LAN reach is a published-port setting (`SEARXNG_HOST`), and the compose default
  publishes on every interface. JSON is off by default (`search.formats: [html]`), and an
  unlisted format gets HTTP 403. The default web engines are DuckDuckGo, Brave (page
  scraping), Google (the keyless Programmable Search element), Wikipedia and Wikidata. Each
  sees the verbatim query and the public IP of the network SearXNG runs on. No engine
  documents a limit. The project's 2026 tracker shows CAPTCHAs and HTTP 429s on single-user
  instances, often on the first request and from fingerprint mismatches, and SearXNG then
  suspends the engine for 3 minutes to 15 days. Google's and Brave's robots.txt files
  disallow the pages these engines fetch.
- **Keyed, below USD 6.3 (every cloud step fits):** Brave Search API, USD 5 per 1,000 with
  USD 5 of credit a month (about 1,000 requests), GET with the key in a header; Mojeek, GBP 2-3
  (about USD 2.68-4.02), GET with the key in the URL, whose terms allow AI use including model
  evaluation. Exa lite (USD 4) and Serper (USD 1) are also below, but Exa is POST-only and
  Serper's request method could not be verified.
- **Between USD 6.3 and 10.7 (T2 fits; the synthesis retry can be refused):** Exa auto or
  fast (USD 7), Tavily basic (USD 7.50-8, POST-only), SerpApi Production (USD 10 at full use
  of a USD 150 monthly plan).
- **Above USD 10.7 (T2 itself can be refused):** Gemini grounding with Google Search (USD 14
  per executed search after 5,000 free a month on the paid tier), Grounding with Bing
  (USD 14, no allowance stated), Tavily advanced (USD 16), SerpApi's smaller plans
  (USD 15-25). Both grounding services are model tools: the model writes the queries, so no
  receipt can bind them before dispatch, and Google's terms bar using grounded links to find
  pages to crawl or scrape, which is what R3 and R4 do with search results.
- **Disclosure.** SearXNG spreads each query over several organisations under the owner's
  network IP, with no account attached. A keyed API concentrates the queries at one provider
  under the owner's account, with stated retention: Brave and Mojeek 90 days, SerpApi 31.

## The thresholds

Review §5.2 and E4's row (§5.6) set the bands at R2's 30 queries per task, with T1 at its
USD 0.10 maximum. A keyed price of p per 1,000 queries costs 0.03 × p per task, and
0.54 × p over E4's 18 retrievals of 30 queries (540 queries).

| Price per 1,000 queries | Search per task | What the USD 0.75 episode cap does |
| --- | --- | --- |
| up to USD 6.3 | up to USD 0.19 | Every cloud step of the cloud-assisted arm, the synthesis retry included, is certain to fit |
| USD 6.3-10.7 | USD 0.19-0.32 | T2 is certain to fit; the synthesis retry can be refused (it still fits up to about USD 8.3 after a v3-like USD 0.04 plan reply) |
| above USD 10.7 | above USD 0.32 | T2 itself can be refused (it still fits up to about USD 12.7 after a v3-like plan reply) |

A free allowance can make the settled fee zero, but the host cannot know at dispatch whether
a request falls inside it, so the reservation that the cap check counts stays at list price.

## 1. SearXNG, self-hosted

### 1.1 Installing it on the Mac or the device

- **Paths.** The project offers a container, an installation script and a step-by-step
  install, and recommends the container or the script ([installation][sx-install]).
- **Container.** The official image is `docker.io/searxng/searxng`, mirrored at
  `ghcr.io/searxng/searxng`; the docs point to the mirror because Docker Hub rate-limits
  anonymous pulls. The documented route is the compose template in the repository's
  `container/` directory: copy `.env.example` to `.env`, then run `docker compose up -d`. It
  starts two services, `core` (SearXNG under the Granian server on port 8080) and `valkey`.
  Docker and Podman are both covered; custom images are not supported
  ([container install][sx-docker], [compose file][sx-compose]).
- **Versions.** Tags combine a date and a commit (newest on 2026-11-08:
  `2026.11.6-ac11e14c5`, pushed 2026-11-06), plus `latest`. Each is built for linux/amd64,
  linux/arm64 and linux/arm/v7 ([Docker Hub tags][sx-hub]). `.env.example` offers
  `SEARXNG_VERSION` to pin a tag ([.env.example][sx-env]).
- **The Mac.** No SearXNG install page mentions macOS. The container needs a Linux VM
  runtime there: Docker Desktop, free for personal use and for businesses under 250
  employees and USD 10 million revenue ([Docker Desktop licence][dk-licence]), or Podman. The
  arm64 image matches Apple silicon.
- **The device.** The arm64 image matches the device (an NVIDIA Jetson module, PLAN.md D5).
  Without a container, the script installs a uWSGI setup under a `searxng` user
  ([script][sx-script]), and the step-by-step page gives package commands for Ubuntu or
  Debian, Arch, and Fedora or RHEL only ([step by step][sx-manual]). The device's OS has to be
  checked against that list.
- **Instance secret.** The container's settings template holds a placeholder `secret_key`,
  which the entrypoint replaces with a random value at first start ([template][sx-template],
  [entrypoint][sx-entry]). The generated settings file is instance state and stays out of
  this repository.

### 1.2 Binding to loopback or LAN, and keeping the UI private

- **The published port decides reach.** Inside the container Granian listens on all
  addresses, port 8080 ([Dockerfile][sx-dockerfile]). The compose file publishes on
  `SEARXNG_HOST` when it is set and on every interface when it is not; `.env.example`'s
  commented example is `[::]`, all addresses ([compose file][sx-compose],
  [.env.example][sx-env]). `SEARXNG_HOST=127.0.0.1` gives loopback only; one LAN address
  gives LAN only.
- **Docker's own warnings.** Docker documents publishing as insecure by default (reachable
  beyond the host) and a `127.0.0.1` or `::1` publish as host-only
  ([port publishing][dk-ports]). On Linux, traffic to published ports is routed before ufw's
  rules apply, and Docker adds a firewalld zone that accepts it
  ([packet filtering][dk-fw]). On the device the bind address, not the host firewall, is
  therefore the control.
- **Outside a container,** `server.bind_address` defaults to `127.0.0.1` and the port to
  8888 ([settings.yml][sx-settings-server], [server settings][sx-doc-server]).
- **Public-instance features are off.** `server.public_instance` and `server.limiter`
  default to `false`. The limiter is inbound bot protection and needs Valkey; its `pass_ip`
  list exempts named addresses, such as the broker's, if it is ever turned on
  ([limiter][sx-limiter]).
- **No setting removes the web UI.** Two levers keep it out of use: the bind address, and
  dropping `html` from `search.formats`. `/search` then answers 403 to any HTML request while
  `format=json` still works; the start page itself still renders
  ([format check][sx-webapp-403], [start page][sx-webapp-index]).

### 1.3 JSON output is off by default

- `search.formats` defaults to `html` alone; `csv`, `json` and `rss` must be added
  ([settings.yml][sx-settings-formats], [search settings][sx-doc-search]). A request for a
  format that is not listed gets 403 Forbidden ([search API][sx-api]).
- `/` and `/search` accept GET and POST. Documented parameters include `q`, `categories`,
  `language`, `pageno`, `time_range`, `format` and `safesearch` ([search API][sx-api]). The
  code also accepts `engines`, a comma-separated list that sends the query to exactly those
  engines instead of the category defaults ([webadapter.py][sx-webadapter]).
- The JSON reply holds `query`, `results`, `answers`, `corrections`, `infoboxes`,
  `suggestions` and `unresponsive_engines`: the engines that failed, each with a reason such
  as a CAPTCHA or too many requests. Each result names the engines that returned it
  ([webutils.py][sx-webutils], [result fields][sx-results]).
- `server.method` has defaulted to GET since 2026-08-12, but it only sets the UI form's
  method ([commit 1c3bb1e][sx-c-get]).

### 1.4 Engines: configuration and what each one sees

**Configuration.**

- Each engine is an entry under `engines:` in settings.yml. `disabled` turns an engine off
  but leaves it selectable; `inactive` does not load it and is the default for engines that
  need a key. Other keys include `api_key`, `tokens` (a private engine), `timeout`,
  `proxies`, `using_tor_proxy` and `send_accept_language_header`
  ([engine settings][sx-doc-engines]).
- With `use_default_settings: true`, which the container template uses, a short file
  inherits the defaults. `use_default_settings.engines.keep_only` keeps only the listed
  engines, and `remove` drops some ([settings file][sx-doc-settings]).
- A query goes to every enabled engine of the selected categories (`general` by default),
  or only to the engines named in `engines` ([webadapter.py][sx-webadapter]). The docs count
  261 engines, 81 of them enabled by default ([configured engines][sx-configured]).

**Defaults for web search at `ac11e14`** ([settings.yml][sx-settings]).

- **Enabled:** `duckduckgo`; `brave`, which scrapes search.brave.com's result pages;
  `google cse`, which calls Google's Programmable Search element without a key; and
  `wikipedia` and `wikidata`, which return infoboxes rather than result-list entries. The
  translation, dictionary and currency engines in `general` fire only on queries of their
  own shape. By default, then, DuckDuckGo, Brave and Google would feed R3's result list.
- **Disabled but selectable:** `google` (inactive until 2026-08-22, [PR 6546][sx-pr6546]),
  `bing` (since 2022, [commit][sx-c-bing]), `qwant` (since 2026-05-26 because its rate
  limits are very strict, [commit][sx-c-qwant]), `yahoo`, `yandex`, `mwmbl` and `yep`.
- **Inactive:** `startpage` and `mojeek`, whose settings comments cite proof-of-work
  CAPTCHAs, and the keyed `braveapi` and `marginalia`.
- **Churn.** The settings file's 2026 history adds engines most weeks and removes others that
  went behind Cloudflare or CAPTCHA walls; presearch was removed on 2026-07-30
  ([history][sx-history]).

**What each default engine receives** (engine source at `ac11e14`).

| Engine | Request SearXNG makes | Receives the query |
| --- | --- | --- |
| duckduckgo | A form POST to DuckDuckGo's no-JavaScript HTML endpoint with `q`, the region `kl` and an optional time filter; a random Firefox User-Agent, Accept-Language, and browser-like Sec-Fetch and Referer headers ([duckduckgo.py][sx-ddg]) | DuckDuckGo |
| brave | A GET of search.brave.com's results page with `q`, plus cookies for safe search, country, UI language and location off ([brave.py][sx-brave]) | Brave |
| google cse | A GET to Google's Programmable Search element endpoint with `q`, SearXNG's built-in engine id, a token fetched from Google, and language and country codes ([google_cse.py][sx-gcse]) | Google |
| wikipedia | A GET of the REST page-summary endpoint with the query as the page title ([wikipedia.py][sx-wp]) | Wikimedia |
| wikidata | A SPARQL query that embeds the query text, with a random browser User-Agent ([wikidata.py][sx-wd]) | Wikimedia |

Every engine also gets the following.

- **The network's public IP.** The project's privacy page says engines see the IP of the
  instance ([why a private instance][sx-own]). For an instance on the device or the Mac
  that is the owner's own connection, unless `outgoing.proxies` routes requests through an
  HTTP or SOCKS proxy or Tor ([outgoing settings][sx-doc-outgoing]). PRIVATE_WORK_DESIGN_V1.md
  says SearXNG strips identity; that holds for cookies and the browser fingerprint, not for
  the IP.
- **No SOAR identity.** SearXNG sends engines no cookies from its own client and uses a
  random browser profile per request ([why a private instance][sx-own]).
- **A Chrome-like TLS fingerprint.** Since the curl_cffi migration of 2026-09-04 the network
  layer impersonates Chrome by default ([commit][sx-c-cffi], [client.py][sx-client]).

**Query syntax.** SearXNG reads leading tokens of `q` as instructions: `!name` selects an
engine or category, `!!name` redirects to an external search site, a bare `!!` redirects to
the first result, `:xx` sets the language and `<n` sets a timeout ([query.py][sx-query],
[redirects][sx-webapp-bang]). A bound query template has to neutralise them, or a
model-written query could change the engine set or turn the reply into a redirect.

### 1.5 Rate limiting, CAPTCHAs and blocking

- **No safe rate is documented.** No engine publishes a limit for this traffic, and SearXNG
  documents none. Its limiter page names the mechanism: an instance that relays bot traffic
  can itself be classed as a bot and then meets CAPTCHAs or blocks
  ([limiter][sx-limiter]). Its privacy page ties CAPTCHAs and IP bans to unprotected public
  instances ([why a private instance][sx-own]). Its CAPTCHA page shows how to solve an
  engine's CAPTCHA from the server's IP through an SSH SOCKS tunnel, with Qwant as the
  example ([answer CAPTCHA][sx-captcha]).
- **Suspensions.** After an engine error SearXNG suspends that engine. Defaults at
  `ac11e14`: access denied (HTTP 402 or 403) 180 s, CAPTCHA 3,600 s, too many requests
  (HTTP 429) 180 s, Cloudflare CAPTCHA 1,296,000 s (15 days), Cloudflare access denied
  86,400 s, reCAPTCHA 604,800 s (7 days) ([settings.yml][sx-settings-susp]). The defaults
  moved from hours to minutes on 2026-02-22 ([commit][sx-c-susp]), but the docs page still
  shows the older 86,400 s for access denied and CAPTCHA and 3,600 s for HTTP 429
  ([search settings][sx-doc-search]). The DuckDuckGo engine raises its CAPTCHA with no
  suspension ([duckduckgo.py][sx-ddg-captcha]).
- **The 2026 record in the project's tracker**, single-user self-hosted instances included:
  - Brave: HTTP 429 on the very first search of a new Raspberry Pi instance, closed as a known
    issue ([searxng#6402][sx-i6402], 2026-07-12); HTTP 429 on every single request with the
    October images ([searxng#6819][sx-i6819], 2026-10-05), which a commenter traced to a
    header that did not match the impersonated browser rather than to an IP ban.
  - DuckDuckGo: a CAPTCHA on every query from about 2026-08-27, which a commenter traced to a
    User-Agent that did not match the TLS fingerprint; the issue closed on 2026-09-04, the
    day the curl_cffi migration landed ([searxng#6596][sx-i6596]). Separately, a CAPTCHA on
    every query when the language is "all", open since 2026-09-24
    ([searxng#6779][sx-i6779]); in that thread a maintainer puts the engine's reliability on
    his own instance at about 90% and calls occasional CAPTCHAs normal.
  - Google: answered with a JavaScript requirement from 2026-07-01
    ([searxng#6359][sx-i6359]); restored on 2026-08-22 by sending Nokia phone User-Agents,
    the PR's author reporting 36,000 requests in 12 hours at full success on his instance
    ([PR 6546][sx-pr6546]).
  - Qwant disabled for strict rate limits; Startpage and Mojeek inactive behind proof-of-work
    CAPTCHAs (§1.4).
- **Reading for E4.** E4's 18 retrievals of 30 queries are 540 queries over its ten days,
  about 2,700 upstream requests with the five default engines. That is low volume, but the
  record shows blocks triggered by a fingerprint mismatch on the first request at least as
  often as by rate, and breakages that lasted weeks before a release fixed them. Whether a
  given engine set answers all 18 retrievals cannot be read from documentation; it needs a
  measurement on the chosen host and version. One CAPTCHA costs an engine an hour, a
  reCAPTCHA a week and a Cloudflare challenge 15 days, so an engine can drop out for most of
  E4. R0-R5 run once per task-repeat and both arms read the same pages, so such a loss
  changes retrieval between repeats, not between arms.

### 1.6 What the upstream engines' terms say

- **Google.** Its Terms of Service (effective 2026-07-30) bar automated access that ignores
  machine-readable instructions such as robots.txt ([terms][g-tos]). Google's main robots.txt
  disallows `/search` for every agent, and the cse.google.com robots.txt disallows everything
  but its about and create pages, which covers the element endpoint that the default
  `google cse` engine calls ([robots][g-robots], [CSE robots][g-cse-robots]).
- **Brave.** search.brave.com's robots.txt disallows `/search` for every agent
  ([robots][b-robots]). Brave's general Terms of Use (2023-05-11) bar circumventing access
  limits and imposing a disproportionate load, without naming search ([terms][b-tou]). Brave
  sells the Search API as the programmatic route (§2.2).
- **DuckDuckGo.** Its terms (dated 01-07-2025) and Acceptable Use Policy have no explicit
  automated-query clause. They reserve suspension and bar displaying parts of the services
  inside another service ([terms][d-terms], [policy][d-aup]). The robots.txt of its HTML
  endpoint allows every path ([robots][d-robots]).
- **Wikimedia.** Its User-Agent policy (edited 2026-03-27) asks automated clients for a
  descriptive agent with contact details, and says browser or generic agents may be refused
  with HTTP 403 or blocked ([policy][w-ua]). SearXNG sends browser-like agents there.
  `outgoing.useragent_suffix` adds contact details only for engines that use SearXNG's own
  agent ([outgoing settings][sx-doc-outgoing]), and doing so would identify the operator.

### 1.7 Consequences for the broker

- **Neither placement fits today's `public_web`.** It requires HTTPS except for loopback
  fixtures (`destination_tls_required`, [broker.ts:278-279][soar-broker]) and refuses
  non-public addresses (broker.ts:680-683). A SearXNG instance on loopback or the LAN serves
  plain HTTP on a private address, so review §5.5's new kind or `public_web` variant is needed
  either way.
- **Mac or device.** On the Mac the hop stays on loopback. On the device the query bytes
  cross the LAN, in plaintext unless TLS is added, and the receipt pins the device's LAN
  address. If both machines share one internet connection, the engines see the same public
  IP either way.
- **The ledger stops at the hop.** What SearXNG sends upstream is outside the receipt: the
  egress IP, headers, cookies and methods (DuckDuckGo receives a POST although the broker's
  hop is a GET). The receipt can record the engine set requested and the engines that
  failed.
- **No keyed engines behind a zero-fee receipt.** SearXNG ships keyed engines: `braveapi`
  (inactive, empty key, [braveapi.py][sx-braveapi]), an Exa API engine (added 2026-07-28),
  Kagi (2026-06-12) and a paid Yandex API (2026-08-13) ([history][sx-history]). Routing a keyed
  API through SearXNG would put a fee behind receipts that say zero.

## 2. Keyed search APIs

### 2.1 Prices against the thresholds

Per-task and E4 figures are the list price times 30 and 540 queries. GBP is converted at the
ECB reference rates of 2026-11-06: EUR 1 = USD 1.1165 = GBP 0.83415, so GBP 1 ≈ USD 1.3385
([ECB][ecb]).

| Option | Request | List price per 1,000 (USD) | Free allowance | Per task | E4 (540) | Band |
| --- | --- | --- | --- | --- | --- | --- |
| SearXNG, self-hosted | GET to own instance | 0 | none needed | 0 | 0 | fits every cap |
| Serper | method not verified | 1.00 (USD 50 for 50,000, valid 6 months) | 2,500 queries, no card | 0.03 | 0.54 | up to 6.3 |
| Mojeek, Startup / Business | GET, key in the URL | GBP 2 / 3 ≈ 2.68 / 4.02 | a free credit of unstated size; a card opens the account | 0.08 / 0.12 | 1.45 / 2.17 | up to 6.3 |
| Exa, lite | POST only | 4 | USD 10 of credit a month, no card | 0.12 | 2.16 | up to 6.3 |
| Brave Search API, Search plan | GET, key in a header | 5 | USD 5 of credit a month (about 1,000 requests); card required | 0.15 | 2.70 | up to 6.3 |
| Exa, auto or fast | POST only | 7 | as Exa lite | 0.21 | 3.78 | 6.3-10.7 |
| Tavily, basic | POST only | 8 pay-as-you-go; 7.50 on the USD 30 monthly plan | 1,000 credits a month, no card | 0.24 | 4.32 | 6.3-10.7 |
| SerpApi, Production | GET, key in the URL | 10 at full use of USD 150 for 15,000 a month | 250 a month | 0.30 | USD 150 a month whatever the use | 6.3-10.7 |
| Exa, deep | POST only | 12 | as Exa lite | 0.36 | 6.48 | above 10.7 |
| Gemini grounding with Google Search (Gemini 3 and newer, paid tier) | POST model call; the model writes the queries | 14 per search executed, plus model tokens | 5,000 searches a month shared across those models; 1,500 a day cap; none on the free tier | 0.42 | 7.56 above the allowance | above 10.7 |
| Grounding with Bing Search | agent tool in Microsoft Foundry | 14 per transaction | none stated | 0.42 | 7.56 | above 10.7 |
| SerpApi, Developer / Starter | GET, key in the URL | 15 / 25 at full use (USD 75 for 5,000; USD 25 for 1,000) | 250 a month | 0.45 / 0.75 | USD 75 / 25 a month | above 10.7 |
| Tavily, advanced | POST only | 16 | as Tavily basic | 0.48 | 8.64 | above 10.7 |
| Google Custom Search JSON API | GET | 5 after 100 a day | not applicable | not applicable | not applicable | closed to new customers; ends 2027-01-01 |

E4's 540 queries fit inside one month of Brave's credit, Tavily's 1,000 basic credits, Exa's
USD 10, Serper's 2,500 or Gemini's 5,000, but not SerpApi's 250. The reservation still stays
at list price (see the thresholds above).

### 2.2 Brave Search API

- **Plans.** Search costs USD 5 per 1,000 requests, includes USD 5 of credit each month,
  applied automatically, and allows 50 queries per second. Answers costs USD 4 per 1,000 plus
  USD 5 per million tokens. Enterprise is custom and adds zero data retention. A credit card
  is required to deter abuse, and results come only from Brave's own index
  ([Brave Search API][b-api]).
- **Request.** GET with the key in the `X-Subscription-Token` header; up to 20 results per
  request; `offset` up to 9 ([documentation][b-docs]).
- **Terms** (updated 2026-09-01, [terms][b-terms]). §3(b)(i): no storing, caching or building
  a database of results beyond transient storage needed to run the application.
  §3(b)(xiii): no use of results to create, evaluate, train, fine-tune, benchmark or
  otherwise improve AI models or services, the customer's or anyone else's. §4(d):
  attribution is optional (POWERED BY BRAVE with the logo, if used). §3(b)(v): no bypassing
  rate limits, including through extra accounts. The pricing FAQ says storing results or
  training needs a plan that includes storage rights; the terms define none, though an Order
  Form overrides them (§14.2).
- **Privacy notice** (updated 2026-11-03, [notice][b-privacy]). A record of queries is kept
  for up to 90 days. IP address and token serve troubleshooting, billing and abuse
  prevention. The account holds name, email and the key. Zero retention is offered only to
  Enterprise clients, subject to legal obligations.
- **For E4.** Two planned uses meet these clauses: retaining result lists so re-runs work
  offline (§3(b)(i)), and grading SOAR on DeepResearch Bench and LiveDRBench with Brave
  results among its inputs, which may count as using results to evaluate or benchmark an AI
  service (§3(b)(xiii)). The owner would need both cleared, for example with Brave in
  writing, before relying on Brave in E4.

### 2.3 Gemini grounding with Google Search

- **Price.** For Gemini 3 and newer on the paid tier: 5,000 search requests a month free,
  shared across those models, then USD 14 per 1,000, with a cap of 1,500 a day. One Gemini
  request can run several searches and each is billed; empty queries are not counted. The
  free tier has no grounding for these models. Gemini 2.5 models bill USD 35 per 1,000
  grounded prompts after 1,500 free a day. Model tokens are billed on top: Gemini 3.8 Flash
  costs USD 0.75 input and 3.75 output per million tokens until 2026-12-31 and twice that
  from 2027-01-01; Gemini 3.1 Flash-Lite costs USD 0.25 and 1.50 ([pricing][g-pricing],
  [grounding][g-grounding]). The review's USD 14 above 5,000 free a month is current.
- **Mechanics.** A POST to the model API with the `google_search` tool. The model decides
  whether to search and writes the queries; the reply carries the executed queries, search
  suggestions to render and URL citations ([grounding][g-grounding]).
- **Terms** (effective 2026-03-23, [Gemini API terms][g-terms]). Grounded results and their
  search suggestions may be shown only to the end user who sent the prompt, in an
  application the customer operates. No caching, analysing, training on or otherwise
  learning from grounded results or suggestions. No programmatic collection of the links,
  indexing them, or using them to find pages to crawl or scrape. Storage is allowed only for
  narrow purposes. Google keeps prompts, context and output for 30 days to produce grounded
  results. On unpaid quota Google may use prompts and responses to improve its products,
  with human review.
- **Fit with R2.** It is not a GET; the host cannot fix or count the queries before
  dispatch, so R2's bound template and 30-query cap could only be checked after billing; the
  whole prompt is disclosed, not a query; and feeding the cited URLs to R4 conflicts with the
  link clause.

### 2.4 Mojeek Search API

- **Price.** Startup costs GBP 2 per 1,000 requests (5 per second, 100,000 a day, up to 10
  results); Business costs GBP 3 (10 per second, 400,000 a day, up to 40 results). Prices
  exclude VAT, there is no minimum commitment, a bank card opens the account without
  automatic payments, and Startup comes with a free credit of unstated size
  ([Mojeek Search API][m-api]).
- **Request.** GET with `api_key` in the query string and `fmt=json`
  ([quickstart][m-quick], [parameters][m-params]). With the key in the URL, the receipt's
  recorded URL must be redacted.
- **Terms** (undated, [API terms][m-terms]). Results may be used in AI applications,
  including grounding, retrieval-augmented generation, agents and model evaluation; no
  attribution is required. Without storage rights, results may be cached for up to an hour
  to serve the same user; plans with storage rights may keep them indefinitely; no plan may
  use them to build a search index. Mojeek acts as the customer's processor for personal
  data in queries, under a DPA.
- **Retention and plans.** The plan page lists standard 90-day data retention with zero
  retention on request. It lists storage rights and AI usage on both plans, but its FAQ
  limits Startup to one-hour caching, so the page conflicts on Startup
  ([Mojeek Search API][m-api]).
- **Index.** Mojeek runs its own crawler and independent index ([Mojeek Search API][m-api]);
  how well its results serve E4's tasks is unmeasured.

### 2.5 Other options checked

- **SerpApi.** Monthly plans: free 250 searches (50 an hour), Starter USD 25 for 1,000,
  Developer USD 75 for 5,000, Production USD 150 for 15,000, Big Data USD 275 for 30,000;
  cached repeats within an hour are free ([pricing][sa-pricing]). GET with `api_key` as a
  query parameter ([API][sa-api]). Search data is kept 31 days, a ZeroTrace mode keeps it off
  SerpApi's systems, and its legal shield for scraping liability covers Production and above,
  under US law only ([legal][sa-legal]). It resells scraped Google results, and a
  subscription leaves most of a plan unused at SOAR's volume.
- **Serper.** USD 50 for 50,000 queries (USD 1.00 per 1,000), down to USD 0.30 per 1,000 at
  12.5 million; credits valid 6 months; 2,500 free queries without a card; only successful
  responses are charged ([serper.dev][se-home]). Its request method could not be verified
  from first-party documentation, because the playground redirects to sign-in. Its terms
  (updated 2024-05-29) describe a business-to-business service selling web-scraped data, not
  affiliated with Google, and say nothing on query retention ([terms][se-terms]).
- **Tavily.** 1,000 credits a month free without a card; USD 0.008 per credit pay-as-you-go;
  USD 30 for 4,000 credits a month; a basic search costs 1 credit and an advanced one 2
  ([pricing][t-pricing], [credits][t-credits]). POST only, with a JSON body and a bearer key,
  up to 20 results ([API][t-api]). Its terms (updated 2026-05-04) let Tavily and its AI
  providers train on customer inputs and outputs (§6.5) and grant Tavily a perpetual licence
  to store and process inputs (§9.2) ([terms][t-terms]).
- **Exa.** Per 1,000 requests of up to 10 results: lite USD 4, auto and fast USD 7, deep
  USD 12; USD 1 per 1,000 results beyond 10; contents USD 1 per 1,000 pages; USD 10 of credit
  on sign-up and each month, no payment method needed; zero data retention only on
  Enterprise, USD 12,000 a year ([pricing][e-pricing]). POST only ([API][e-api]). Its terms are
  a PDF that could not be parsed in this session, so they were not checked ([terms][e-terms]).
- **Bing's successor.** The Bing Search APIs were retired on 2025-08-11
  ([retirement][ms-retire]). Microsoft points to Grounding with Bing Search inside Foundry
  agents, at USD 14 per 1,000 transactions and 150 a second, with no free allowance stated
  ([pricing][ms-pricing]). The agent's model writes the queries; developers get the model's
  answer with citations and the Bing query URL, both to be displayed as provided, never the
  raw results; data leaves the Azure compliance boundary; only paid Azure subscriptions
  qualify ([how-to][ms-bing], [overview][ms-web]). R2 needs the raw result list for local
  triage, so it has no place there.
- **Google Custom Search JSON API.** Closed to new customers; existing customers have until
  2027-01-01. It offered 100 queries a day free, then USD 5 per 1,000 up to 10,000 a day
  ([overview][g-cse]).

## 3. Disclosure and the per-query receipt

### 3.1 What each option discloses

| Option | Receives each query | Also receives | Retention the recipient states |
| --- | --- | --- | --- |
| SearXNG, default set | DuckDuckGo, Brave, Google and Wikimedia: five requests to four organisations | The public IP of the network SearXNG runs on; browser-like headers; region and language codes; no account | DuckDuckGo: IP never stored with searches, queries kept only anonymously ([privacy][d-privacy], dated 06-03-26). Brave Search: IP deleted within seconds, queries kept de-identified with platform, OS, country, language and date ([privacy][b-search-privacy], undated). Google: search terms and IP collected, held under browser or device identifiers when signed out ([privacy][g-privacy], effective 2026-10-16). Wikimedia: not read |
| SearXNG, engines fixed per query | Only the named engines | As above | As above |
| Brave Search API | Brave | The key, so the account (name, email, card); the caller's IP | Query records up to 90 days; zero retention only on Enterprise |
| Mojeek API | Mojeek | The key and account; the caller's IP | 90 days standard, zero on request; processes personal data in queries as the customer's processor |
| SerpApi | SerpApi, which then queries Google from its own systems | The key and account | 31 days; ZeroTrace mode keeps searches off its systems |
| Serper | Serper, which serves scraped Google results | The key and account | Not stated |
| Tavily | Tavily and its AI providers | The key and account | Perpetual licence to store inputs; may train on inputs and outputs |
| Exa | Exa | The key and account | Zero retention only on Enterprise |
| Gemini grounding | Google | The whole prompt and context, not just a query; the project and billing account | Prompts, context and output kept 30 days for grounding; unpaid quota may be used to improve products, with human review |
| Grounding with Bing | Microsoft's Bing service | The model's queries, tool parameters and the resource key, outside the Azure compliance boundary | Bing's grounding terms |

Every hosted API also costs a DNS lookup of its host name through the broker's resolver,
which PRIVATE_WORK_DESIGN_V1.md already counts as a disclosure for the Cloudflare resolver.
For SearXNG, the lookups of the engines' host names go through the SearXNG host's own
resolver. One SearXNG query is disclosed to as many organisations as the set has engines,
while the review counts unique bytes sent; whether such a query counts once or once per
recipient is not yet decided.

### 3.2 What each receipt must record

The review requires (R2 in §5.2, the first bullet of §5.5, and §5.2's privacy paragraph):

- one receipt per query, at most 30 per task, GET only;
- for SearXNG, credentials refused, DNS pinned for the hop, a zero fee, and the engine set
  recorded on each receipt;
- queries counted as disclosed bytes (unique bytes sent), so a task with any search
  dispatch loses the "no cloud, search or web dispatch" badge;
- a keyed API only as an owner-keyed alternative, under exact-byte consent and the 30-query
  cap, with its fees counted in each episode's USD 0.75 cap.

The facts above add the following, as proposals for backlog item 12, not decisions:

1. **The exact query bytes as sent,** after the template neutralises the `!`, `!!`, `:` and
   `<` prefixes, and the full request URL with any key redacted. Mojeek and SerpApi carry
   the key in the URL; Brave carries it in a header.
2. **The engine set as sent,** from an explicit `engines` list, with the SearXNG image tag and
   a hash of its settings, because default sets change between releases.
3. **The engines that failed,** from `unresponsive_engines` with their reasons, so that a
   CAPTCHA or HTTP 429 is a recorded miss and the answering set is known.
4. **The hop:** loopback or the device's LAN address and port, and HTTP or HTTPS.
5. **For a keyed API:** the provider; the key's name, never its value; the list-price
   reservation; the settled fee, and how it was reconciled when a free allowance may have
   absorbed it; the exact-byte consent; and the provider's retention and storage terms as
   approved.
6. **The response hash and result count,** and whether the result list was retained, since
   Brave allows only transient storage and Mojeek's no-storage plans one hour.
7. **For Gemini or Bing grounding,** no receipt can bind the queries before dispatch; they are
   known only from the reply.

## 4. Open points for the owner

These are for decision 8 in [#58][i58]; none is settled here.

1. **SearXNG or keyed.** SearXNG pays no fee and lets each receipt bind the exact bytes and
   engine set, but sends the owner's network IP to every engine, has unmeasured reliability,
   and by default fetches pages whose robots.txt disallows it (Google, Brave). A keyed API
   puts a fee inside the cap and the queries at one contracted provider, logged against the
   owner's account.
2. **Where SearXNG runs.** On the Mac on loopback, with no LAN hop, or on the device over
   the LAN, in plaintext unless TLS is added. Either needs the new broker kind.
3. **Which engines.** The default set (DuckDuckGo, Brave scraping, Google's element,
   Wikipedia, Wikidata) or a narrower one; whether to accept the Google and Brave robots.txt
   position; whether Wikimedia gets browser-like agents or a contact agent that identifies
   the operator; and whether an outgoing proxy should hide the IP, at an unmeasured cost in
   CAPTCHAs.
4. **Disclosed bytes:** counted once per query, or once per recipient.
5. **E4 reliability.** Whether to pin the SearXNG tag for all of E4 or allow an update when
   an engine breaks; how many engines must answer for a retrieval to count; and whether to
   run a zero-fee qualification batch on the chosen host before E4. That batch is itself
   traffic to the new destination, so it needs the approval first.
6. **If keyed, which provider.** Brave: USD 5, a header key, 90-day account-linked logs, and
   the storage and AI-evaluation clauses to clear for E4. Mojeek: about USD 2.7-4.0, a URL key,
   terms that allow AI use including model evaluation, storage only on plans with storage
   rights, and an unmeasured index. In either case, whether the reservation stays at list
   price inside free credits.
7. **Grounding services.** Gemini and Bing grounding do not meet R2 as written (no GET,
   model-written queries, no raw results or no crawl use of links). The review's USD 14 is
   right for Gemini 3 and newer, but it prices a different kind of service.
8. **Re-read at approval.** SearXNG's defaults change most weeks, prices and terms are
   current only as of 2026-11-08, Gemini 3.8 Flash's token prices double on 2027-01-01, and
   the Google Custom Search JSON API ends that day.

**What this note does not show.** No engine or API was exercised, so nothing here measures
block rates, latency or result quality. Exa's terms and Wikimedia's privacy policy were not
read, no search-specific Brave Search terms page was found, and Serper's request method is
unverified.

## Sources

All read on 2026-11-08.

- SOAR: [review][soar-review] §5.2 (R2, the cap check), §5.5, §5.6 (E4) and §5.10 (item 8);
  [PLAN.md][soar-plan] §4; [PRIVATE_WORK_DESIGN_V1.md][soar-design] (web search note);
  [broker.ts][soar-broker] at `8ea902e`.
- SearXNG documentation: [installation][sx-install], [container][sx-docker],
  [script][sx-script], [step by step][sx-manual], [settings file][sx-doc-settings],
  [server][sx-doc-server], [search][sx-doc-search], [engines][sx-doc-engines],
  [outgoing][sx-doc-outgoing], [limiter][sx-limiter], [CAPTCHA][sx-captcha],
  [private instance][sx-own], [search API][sx-api], [configured engines][sx-configured].
- SearXNG source at `ac11e14`: [settings.yml][sx-settings], [webapp.py][sx-webapp-403],
  [webadapter.py][sx-webadapter], [webutils.py][sx-webutils], [result fields][sx-results],
  [query.py][sx-query], [client.py][sx-client], [duckduckgo.py][sx-ddg],
  [brave.py][sx-brave], [google_cse.py][sx-gcse], [wikipedia.py][sx-wp],
  [wikidata.py][sx-wd], [braveapi.py][sx-braveapi], [compose file][sx-compose],
  [.env.example][sx-env], [Dockerfile][sx-dockerfile], [entrypoint][sx-entry],
  [template][sx-template]; [settings history][sx-history]; commits
  [be836e6][sx-c-cffi], [76f0712][sx-c-susp], [1c3bb1e][sx-c-get], [f1a22de][sx-c-qwant],
  [cea7b71][sx-c-bing]; tracker [6402][sx-i6402], [6819][sx-i6819], [6596][sx-i6596],
  [6779][sx-i6779], [6359][sx-i6359], [PR 6546][sx-pr6546]; [Docker Hub tags][sx-hub].
- Docker: [port publishing][dk-ports], [packet filtering][dk-fw],
  [Desktop licence][dk-licence].
- Brave: [Search API][b-api], [documentation][b-docs], [API terms][b-terms],
  [API privacy notice][b-privacy], [search robots.txt][b-robots], [Terms of Use][b-tou],
  [Search privacy policy][b-search-privacy].
- Google: [pricing][g-pricing] (ai.google.dev's pricing page redirects there),
  [grounding][g-grounding], [Gemini API terms][g-terms], [Terms of Service][g-tos],
  [privacy policy][g-privacy], [robots.txt][g-robots], [CSE robots.txt][g-cse-robots],
  [Custom Search JSON API][g-cse].
- DuckDuckGo: [terms][d-terms], [Acceptable Use Policy][d-aup], [privacy][d-privacy],
  [HTML endpoint robots.txt][d-robots]. Wikimedia: [User-Agent policy][w-ua].
- Mojeek: [Search API][m-api], [quickstart][m-quick], [parameters][m-params],
  [API terms][m-terms]. SerpApi: [pricing][sa-pricing], [API][sa-api], [legal][sa-legal].
  Serper: [home and pricing][se-home], [terms][se-terms]. Tavily: [pricing][t-pricing],
  [credits][t-credits], [API][t-api], [terms][t-terms]. Exa: [pricing][e-pricing],
  [API][e-api], [terms][e-terms] (not parsed).
- Microsoft: [Bing Search API retirement][ms-retire], [grounding pricing][ms-pricing],
  [Grounding with Bing][ms-bing], [web grounding overview][ms-web].
- [ECB reference rates][ecb] of 2026-11-06.

[i48]: https://github.com/Lotus2077/SOAR/issues/48
[i58]: https://github.com/Lotus2077/SOAR/issues/58
[soar-review]: PROJECT_REVIEW_2026-11-05.md
[soar-plan]: PLAN.md
[soar-design]: plans/PRIVATE_WORK_DESIGN_V1.md
[soar-broker]: ../src/main/private-agent/broker.ts
[sx-install]: https://docs.searxng.org/admin/installation.html
[sx-docker]: https://docs.searxng.org/admin/installation-docker.html
[sx-script]: https://docs.searxng.org/admin/installation-scripts.html
[sx-manual]: https://docs.searxng.org/admin/installation-searxng.html
[sx-doc-settings]: https://docs.searxng.org/admin/settings/settings.html
[sx-doc-server]: https://docs.searxng.org/admin/settings/settings_server.html
[sx-doc-search]: https://docs.searxng.org/admin/settings/settings_search.html
[sx-doc-engines]: https://docs.searxng.org/admin/settings/settings_engines.html
[sx-doc-outgoing]: https://docs.searxng.org/admin/settings/settings_outgoing.html
[sx-limiter]: https://docs.searxng.org/admin/searx.limiter.html
[sx-captcha]: https://docs.searxng.org/admin/answer-captcha.html
[sx-own]: https://docs.searxng.org/own-instance.html
[sx-api]: https://docs.searxng.org/dev/search_api.html
[sx-configured]: https://docs.searxng.org/user/configured_engines.html
[sx-hub]: https://hub.docker.com/v2/repositories/searxng/searxng/tags?page_size=3&ordering=last_updated
[sx-settings]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/settings.yml
[sx-settings-susp]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/settings.yml#L69-L81
[sx-settings-formats]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/settings.yml#L85-L86
[sx-settings-server]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/settings.yml#L90-L113
[sx-webapp-403]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/webapp.py#L654-L655
[sx-webapp-index]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/webapp.py#L603-L617
[sx-webapp-bang]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/webapp.py#L686-L720
[sx-webadapter]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/webadapter.py#L172-L208
[sx-webutils]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/webutils.py#L161-L173
[sx-results]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/result_types/_base.py
[sx-query]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/query.py
[sx-client]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/network/client.py#L19
[sx-ddg]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/engines/duckduckgo.py
[sx-ddg-captcha]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/engines/duckduckgo.py#L477
[sx-brave]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/engines/brave.py#L210-L240
[sx-gcse]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/engines/google_cse.py#L95-L129
[sx-wp]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/engines/wikipedia.py#L147-L157
[sx-wd]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/wikidata.py#L29-L33
[sx-braveapi]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/searx/engines/braveapi.py#L60
[sx-compose]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/container/docker-compose.yml
[sx-env]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/container/.env.example
[sx-dockerfile]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/container/Dockerfile#L55-L56
[sx-entry]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/container/entrypoint.sh#L93
[sx-template]: https://github.com/searxng/searxng/blob/ac11e14c5edf995d4d2f066bfb885a614f52a978/container/settings.template.yml
[sx-history]: https://github.com/searxng/searxng/commits/master/searx/settings.yml
[sx-c-cffi]: https://github.com/searxng/searxng/commit/be836e614a2f2e7512e2e1915a0bc37d51ee865c
[sx-c-susp]: https://github.com/searxng/searxng/commit/76f07123193653a6c7f80c2ca9976fdfb029c9a3
[sx-c-get]: https://github.com/searxng/searxng/commit/1c3bb1e88f8781bd725c57a9a1c609ce0bb09926
[sx-c-qwant]: https://github.com/searxng/searxng/commit/f1a22dec9ec7a75c37191fec67550c73df3a9d5a
[sx-c-bing]: https://github.com/searxng/searxng/commit/cea7b71d14c28d0551a6257a7e35d1a055a2d353
[sx-i6402]: https://github.com/searxng/searxng/issues/6402
[sx-i6819]: https://github.com/searxng/searxng/issues/6819
[sx-i6596]: https://github.com/searxng/searxng/issues/6596
[sx-i6779]: https://github.com/searxng/searxng/issues/6779
[sx-i6359]: https://github.com/searxng/searxng/issues/6359
[sx-pr6546]: https://github.com/searxng/searxng/pull/6546
[dk-ports]: https://docs.docker.com/engine/network/port-publishing/
[dk-fw]: https://docs.docker.com/engine/network/packet-filtering-firewalls/
[dk-licence]: https://docs.docker.com/subscription/desktop-license/
[b-api]: https://brave.com/search/api/
[b-docs]: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
[b-terms]: https://api-dashboard.search.brave.com/terms-of-service
[b-privacy]: https://api-dashboard.search.brave.com/privacy-policy
[b-robots]: https://search.brave.com/robots.txt
[b-tou]: https://brave.com/terms-of-use/
[b-search-privacy]: https://search.brave.com/help/privacy-policy
[g-pricing]: https://aistudio.google.com/docs/pricing
[g-grounding]: https://aistudio.google.com/docs/google-search
[g-terms]: https://aistudio.google.com/docs/terms
[g-tos]: https://policies.google.com/terms
[g-privacy]: https://policies.google.com/privacy
[g-robots]: https://www.google.com/robots.txt
[g-cse-robots]: https://cse.google.com/robots.txt
[g-cse]: https://developers.google.com/custom-search/v1/overview
[d-terms]: https://duckduckgo.com/terms
[d-aup]: https://duckduckgo.com/acceptable-use
[d-privacy]: https://duckduckgo.com/privacy
[d-robots]: https://html.duckduckgo.com/robots.txt
[w-ua]: https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy
[m-api]: https://www.mojeek.com/services/search/web-search-api/
[m-quick]: https://www.mojeek.com/support/api/search/quickstart.html
[m-params]: https://www.mojeek.com/support/api/search/request_parameters.html
[m-terms]: https://www.mojeek.com/about/legal/api-terms.html
[sa-pricing]: https://serpapi.com/pricing
[sa-api]: https://serpapi.com/search-api
[sa-legal]: https://serpapi.com/legal
[se-home]: https://serper.dev/
[se-terms]: https://serper.dev/terms
[t-pricing]: https://www.tavily.com/pricing
[t-credits]: https://docs.tavily.com/documentation/api-credits
[t-api]: https://docs.tavily.com/documentation/api-reference/endpoint/search
[t-terms]: https://www.tavily.com/terms
[e-pricing]: https://exa.ai/pricing
[e-api]: https://exa.ai/docs/reference/search
[e-terms]: https://exa.ai/terms
[ms-retire]: https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement
[ms-pricing]: https://www.microsoft.com/en-us/bing/apis/grounding-pricing
[ms-bing]: https://learn.microsoft.com/en-us/azure/ai-foundry/agents/how-to/tools/bing-grounding
[ms-web]: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/web-overview
[ecb]: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
