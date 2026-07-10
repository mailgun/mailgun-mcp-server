// Shared Email Preview QA contract fixtures (G0).
//
// This file is intentionally byte-identical between `mailgun-mcp-server`
// (test/fixtures/email-preview-qa-contract.ts) and `mailgun-cli`
// (src/fixtures/email-preview-qa-contract.ts). The same fixture must produce
// equivalent normalized fields in both repos (spec §16.1), so keep the two
// copies in sync whenever either changes.
//
// It is dependency-free (plain object literals, no imports) so it can be
// consumed by Vitest (MCP) and node:test (CLI) without adapter shims.
//
// Shapes are grounded in the confirmed V2 contract
// (mailgun-inspect-openapi-jun2026.json). Values are synthetic and safe to
// commit; no live credentials or real customer content.
//
// Scenario index (spec §16.1):
//   1  CREATE_ALL_CHECKS                 create accepted, all four checks
//   2  CREATE_DEFAULT_CLIENTS            create accepted, default clients (no reference_id)
//   3  CREATE_INVALID_CLIENT_WARNINGS    create accepted with invalid-client warnings
//   4  RENDER_COMPLETE                   render complete
//   5  RENDER_PROCESSING                 render still processing
//   6  RENDER_PARTIAL                    render partial (a client bounced)
//   7  RENDER_EMPTY                      empty/unknown render arrays
//   8  LINK_RESULT                       link results (passes/failures/informational + impacts)
//   9  IMAGE_RESULT                      image results (passes/failures/informational + impacts)
//   10 ACCESSIBILITY_RESULT              accessibility (failures + needs_review + impacts)
//   11 CODE_ANALYSIS_RESULT              code analysis (feature/support/variant breakdowns)
//   12 CHECK_LIFECYCLE_*                 processing / complete / job_failed / unavailable
//   13 RENDER_CHECK_REFERENCE_MISSING    requested check reference missing
//   14 CHECK_RESULT_404                  unexpected structured-check 404 (behavioral marker)
//   15 POLL_DEADLINE_REACHED             poll deadline reached (behavioral marker)
//   16 CREATE_MISSING_TEST_ID            create response missing a test id
//   17 AMBIGUOUS_CREATE_TRANSPORT_FAILURE ambiguous create transport failure (behavioral marker)
//   18 API_ERROR_401 / _403 / _429 / _5XX  API error bodies
//
// Behavioral markers (14, 15, 17) carry no upstream payload; they are named
// scenario descriptors both repos reference so the poll/error tests stay aligned.

// ---------------------------------------------------------------------------
// Client ids reused across fixtures.
// ---------------------------------------------------------------------------

export const CLIENT_IDS = {
  gmail: 'gmail_chrome',
  outlook: 'outlook_win',
  apple: 'apple_mail',
  lotus: 'lotus_notes'
} as const;

// ---------------------------------------------------------------------------
// Content-check reference blocks (as returned inside create + render payloads).
// Each requested check exposes items.id + items.links.self; a failed check job
// exposes `errors` instead; a not-requested check is null.
// ---------------------------------------------------------------------------

const CHECK_REFS_ALL = {
  link_validation: { items: { id: 'link_001', links: { self: '/v1/inspect/links/link_001' } } },
  image_validation: { items: { id: 'image_001', links: { self: '/v1/inspect/images/image_001' } } },
  accessibility: { items: { id: 'access_001', links: { self: '/v1/inspect/accessibility/access_001' } } },
  code_analysis: { items: { id: 'preview_test_001', links: { self: '/v1/inspect/analyze/preview_test_001' } } }
} as const;

// ---------------------------------------------------------------------------
// 1. Create accepted with all four checks requested.
// ---------------------------------------------------------------------------

export const CREATE_ALL_CHECKS = {
  id: 'preview_test_001',
  reference_id: 'lovable-build-123',
  warnings: [],
  content_checking: CHECK_REFS_ALL
} as const;

// 2. Create accepted using Mailgun default clients (no clients echoed, no reference_id).
export const CREATE_DEFAULT_CLIENTS = {
  id: 'preview_test_002',
  warnings: [],
  content_checking: CHECK_REFS_ALL
} as const;

// 3. Create accepted but Mailgun warns about invalid/unknown client ids.
export const CREATE_INVALID_CLIENT_WARNINGS = {
  id: 'preview_test_003',
  reference_id: 'lovable-build-invalid-clients',
  warnings: [
    { name: 'invalid_client', message: 'Unknown client id: bogus_client' },
    { name: 'invalid_client', message: 'Unknown client id: another_bad_id' }
  ],
  content_checking: CHECK_REFS_ALL
} as const;

// 16. Create response missing a test id (must be treated as a runtime error;
// never poll, never re-POST).
export const CREATE_MISSING_TEST_ID = {
  reference_id: 'lovable-build-no-id',
  warnings: []
} as const;

// ---------------------------------------------------------------------------
// Render states (GET /v2/preview/tests/{test_id}).
// ---------------------------------------------------------------------------

// 4. Render complete: all clients rendered, none processing, none bounced.
export const RENDER_COMPLETE = {
  subject: 'June campaign',
  date: 1782309720,
  completed: [CLIENT_IDS.gmail, CLIENT_IDS.outlook, CLIENT_IDS.apple],
  processing: [],
  bounced: [],
  content_checking: CHECK_REFS_ALL
} as const;

// 5. Render processing: at least one client still processing.
export const RENDER_PROCESSING = {
  subject: 'June campaign',
  date: 1782309720,
  completed: [CLIENT_IDS.gmail],
  processing: [CLIENT_IDS.outlook, CLIENT_IDS.apple],
  bounced: [],
  content_checking: CHECK_REFS_ALL
} as const;

// 6. Render partial: no client processing, at least one bounced.
export const RENDER_PARTIAL = {
  subject: 'June campaign',
  date: 1782309720,
  completed: [CLIENT_IDS.gmail, CLIENT_IDS.outlook],
  processing: [],
  bounced: [CLIENT_IDS.lotus],
  content_checking: CHECK_REFS_ALL
} as const;

// 7. Empty/unknown render arrays -> status "unknown" + data gap.
export const RENDER_EMPTY = {
  subject: 'June campaign',
  date: 1782309720,
  completed: [],
  processing: [],
  bounced: [],
  content_checking: {}
} as const;

// 13. Render complete, but a requested check reference is missing (items with
// neither id nor self) -> lifecycle "unavailable" + data gap.
export const RENDER_CHECK_REFERENCE_MISSING = {
  subject: 'June campaign',
  date: 1782309720,
  completed: [CLIENT_IDS.gmail, CLIENT_IDS.outlook],
  processing: [],
  bounced: [],
  content_checking: {
    link_validation: { items: { id: 'link_010', links: { self: '/v1/inspect/links/link_010' } } },
    image_validation: { items: {} },
    accessibility: null,
    code_analysis: { items: { id: 'preview_test_013', links: { self: '/v1/inspect/analyze/preview_test_013' } } }
  }
} as const;

// 12. Check-lifecycle render variants keyed to the five normalized states.
//   not_requested -> null; processing -> reference present but result pending;
//   complete -> reference present + terminal result; job_failed -> errors[];
//   unavailable -> reference missing / 404 on the result endpoint.
export const RENDER_CHECK_LIFECYCLE = {
  subject: 'June campaign',
  date: 1782309720,
  completed: [CLIENT_IDS.gmail],
  processing: [],
  bounced: [],
  content_checking: {
    // complete: full reference; result resolves to LINK_RESULT.
    link_validation: { items: { id: 'link_001', links: { self: '/v1/inspect/links/link_001' } } },
    // job_failed: the check job errored out (not the same as an email QA failure).
    image_validation: {
      errors: [{ status: '500', title: 'processing_error', detail: 'Image validation job failed to execute.' }]
    },
    // not_requested: caller did not enable this check.
    accessibility: null,
    // processing/unavailable: reference present but result endpoint returns 404
    // while materializing (see CHECK_RESULT_404).
    code_analysis: { items: { id: 'analyze_pending', links: { self: '/v1/inspect/analyze/analyze_pending' } } }
  }
} as const;

// ---------------------------------------------------------------------------
// Structured-check detail results.
// ---------------------------------------------------------------------------

// 8. Link validation: passes/failures/informational with native impacts.
// Includes one failure with a missing impact to exercise the "unknown" bucket.
export const LINK_RESULT = {
  meta: null,
  items: {
    id: 'link_001',
    links: { self: '/v1/inspect/links/link_001' },
    results: [
      {
        url: 'https://example.com/valid',
        status: 'pass',
        status_code: 200,
        line: 12,
        column: 4,
        passes: [
          { id: 'lp1', rule: 'reachable', description: 'Link resolved with 200.', impact: 'informational', details: [] },
          { id: 'lp2', rule: 'https', description: 'Link uses HTTPS.', impact: 'informational', details: [] }
        ],
        failures: [],
        informational: [
          { id: 'li1', rule: 'redirect', description: 'Link redirected once.', impact: 'informational', details: [] }
        ]
      },
      {
        url: 'https://example.com/broken',
        status: 'fail',
        status_code: 404,
        line: 20,
        column: 6,
        passes: [],
        failures: [
          { id: 'lf1', rule: 'reachable', description: 'Link returned 404.', impact: 'critical', details: [] },
          // Missing impact -> counts under "unknown" severity.
          { id: 'lf2', rule: 'tracking', description: 'Untracked link.', details: [] }
        ],
        informational: []
      }
    ]
  }
} as const;

// 9. Image validation: passes/failures/informational with native impacts.
export const IMAGE_RESULT = {
  meta: null,
  items: {
    id: 'image_001',
    total_load_time_ms: 820,
    images: [
      {
        id: 'img1',
        url: 'https://example.com/hero.png',
        status: 'pass',
        line: 30,
        column: 2,
        passes: [
          { id: 'ip1', rule: 'has-alt', description: 'Image has alt text.', impact: 'informational', details: [] }
        ],
        failures: [],
        informational: [
          { id: 'ii1', rule: 'dimensions', description: 'Width/height not set.', impact: 'informational', details: [] }
        ]
      },
      {
        id: 'img2',
        url: 'https://example.com/logo.gif',
        status: 'fail',
        line: 44,
        column: 8,
        passes: [],
        failures: [
          { id: 'if1', rule: 'oversized', description: 'Image exceeds recommended size.', impact: 'moderate', details: [] }
        ],
        informational: []
      }
    ]
  }
} as const;

// 10. Accessibility: failures and needs_review kept separate, with impacts.
export const ACCESSIBILITY_RESULT = {
  meta: null,
  items: [
    {
      checks: 24,
      passes: [
        { rule: 'document-title', impact: 'minor', description: 'Document has a title.', standards: ['WCAG2A'], pour: ['perceivable'], compliance: ['A'], instances: [] }
      ],
      failures: [
        {
          rule: 'color-contrast',
          impact: 'serious',
          description: 'Text has insufficient contrast.',
          standards: ['WCAG2AA'],
          pour: ['perceivable'],
          compliance: ['AA'],
          instances: [
            { correctAny: [], correctAll: [], snippet: '<p style="color:#aaa">', target: ['p'], lineNumber: 55, absoluteIndex: 1200 }
          ]
        },
        {
          rule: 'image-alt',
          impact: 'critical',
          description: 'Image missing alt attribute.',
          standards: ['WCAG2A'],
          pour: ['perceivable'],
          compliance: ['A'],
          instances: [
            { correctAny: [], correctAll: [], snippet: '<img src="logo.gif">', target: ['img'], lineNumber: 44, absoluteIndex: 980 }
          ]
        }
      ],
      needs_review: [
        {
          rule: 'link-name',
          impact: 'moderate',
          description: 'Link text may not be descriptive.',
          standards: ['WCAG2A'],
          pour: ['operable'],
          compliance: ['A'],
          instances: [
            { correctAny: [], correctAll: [], snippet: '<a href="#">here</a>', target: ['a'], lineNumber: 60, absoluteIndex: 1400 }
          ]
        }
      ]
    }
  ]
} as const;

// 11. Code analysis: features with support buckets (y=yes, a=partial, n=no,
// u=unknown) referencing client/variant ids. Application counts require the
// analyze dictionary (parked release gate) -> normalizers must emit a data gap
// rather than inventing application totals.
export const CODE_ANALYSIS_RESULT = {
  meta: null,
  items: {
    id: 'preview_test_001',
    version: 1,
    features: [
      {
        slug: 'font-size',
        name: 'font-size',
        description: 'CSS font-size property',
        category: 'css-properties',
        notes_lookup: {},
        instances: [
          { id: 'fs1', line: 10, column: 3, resolved: false },
          { id: 'fs2', line: 22, column: 5, resolved: false }
        ],
        support: {
          y: [{ id: 'gmail_chrome', notes: [] }, { id: 'apple_mail', notes: [] }],
          a: [{ id: 'outlook_win', notes: ['partial in Word engine'] }],
          n: [{ id: 'lotus_notes', notes: [] }],
          u: []
        }
      },
      {
        slug: 'target-attribute',
        name: 'target attribute',
        description: 'Anchor target attribute',
        category: 'html-attributes',
        notes_lookup: {},
        instances: [{ id: 'ta1', line: 60, column: 8, resolved: false }],
        support: {
          y: [{ id: 'gmail_chrome', notes: [] }],
          a: [],
          n: [{ id: 'outlook_win', notes: [] }],
          u: [{ id: 'lotus_notes', notes: ['unknown'] }]
        }
      }
    ]
  }
} as const;

// Per-client render result (GET /v2/preview/tests/{test_id}/results/{client_id}).
// Object keyed by client id. Detail tool escape hatch; not fetched by default.
export const CLIENT_RESULT = {
  gmail_chrome: {
    id: 'gmail_chrome',
    display_name: 'Gmail (Chrome)',
    client: 'Gmail',
    os: 'Web',
    category: 'Webmail',
    browser: 'Chrome',
    screenshots: { full: 'https://example.com/shot/gmail_full.png' },
    thumbnail: 'https://example.com/shot/gmail_thumb.png',
    full_thumbnail: 'https://example.com/shot/gmail_full_thumb.png',
    status: 'complete',
    status_details: { submitted: 1782309700, completed: 1782309720, bounce_code: '', bounce_message: '' }
  }
} as const;

// Client catalog (GET /v1/preview/tests/clients).
export const CLIENTS_CATALOG = {
  clients: {
    gmail_chrome: { id: 'gmail_chrome', client: 'Gmail', os: 'Web', category: 'Webmail', browser: 'Chrome', rotate: false, image_blocking: false, free: true, default: true, ext: '' },
    outlook_win: { id: 'outlook_win', client: 'Outlook', os: 'Windows', category: 'Application', browser: '', rotate: false, image_blocking: true, free: false, default: true, ext: '' },
    apple_mail: { id: 'apple_mail', client: 'Apple Mail', os: 'macOS', category: 'Application', browser: '', rotate: false, image_blocking: false, free: true, default: true, ext: '' },
    lotus_notes: { id: 'lotus_notes', client: 'Lotus Notes', os: 'Windows', category: 'Application', browser: '', rotate: false, image_blocking: true, free: false, default: false, ext: '' }
  }
} as const;

// ---------------------------------------------------------------------------
// 18. API error bodies (Mailgun surfaces `message`; some endpoints use `Reason`).
// ---------------------------------------------------------------------------

export const API_ERROR_401 = { message: 'Invalid private key' } as const;
export const API_ERROR_403 = { message: 'Email Preview is not enabled for this account' } as const;
export const API_ERROR_429 = { message: 'Too many requests. Preview quota exceeded.' } as const;
export const API_ERROR_5XX = { message: 'Internal server error' } as const;

// ---------------------------------------------------------------------------
// Behavioral markers (no upstream payload). Both repos reference these ids so
// poll/timeout/ambiguity tests describe the same scenario.
// ---------------------------------------------------------------------------

// 14. Unexpected structured-check 404: a referenced result endpoint returns 404
// while materializing. Treat as unavailable + data gap; do NOT retry-on-404
// unless Inspect confirms it as a supported contract (spec §11.5, release gate).
export const CHECK_RESULT_404 = {
  scenario: 'unexpected_structured_check_404',
  status_code: 404,
  path: '/v1/inspect/analyze/analyze_pending',
  expected_lifecycle: 'unavailable',
  expected_data_gap_code: 'result_endpoint_unavailable'
} as const;

// 15. Poll deadline reached: render stays processing until the workflow deadline.
// Return latest evidence with timed_out=true; never create a second test.
export const POLL_DEADLINE_REACHED = {
  scenario: 'poll_deadline_reached',
  render_snapshot: 'RENDER_PROCESSING',
  expected_timed_out: true,
  expected_data_gap_code: 'workflow_timed_out'
} as const;

// 17. Ambiguous create transport failure: the POST may have reached Mailgun
// before the transport failed. Return an API/runtime error, say the test may
// have been created, include reference_id when available, recommend
// list_preview_tests for reconciliation, and do NOT POST again.
export const AMBIGUOUS_CREATE_TRANSPORT_FAILURE = {
  scenario: 'ambiguous_create_transport_failure',
  reference_id: 'lovable-build-123',
  expected_error: true,
  expected_recovery: 'list_preview_tests',
  must_not_retry_post: true
} as const;
