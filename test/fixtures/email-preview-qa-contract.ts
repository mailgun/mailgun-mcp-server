// Shared payload fixtures mirrored in mailgun-cli; keep their literals in sync.
// Synthetic values reflect live V2 responses validated on 2026-07-10.
// Detail status drives check lifecycle independently of client rendering.
// Code analysis uses meta.count; accessibility headlines count rule instances.

// Client ids

export const CLIENT_IDS = {
  gmail: 'gmail_chrome',
  outlook: 'outlook_win',
  apple: 'apple_mail',
  lotus: 'lotus_notes'
} as const;

// Check references expose an id, errors, or null when not requested.

const CHECK_REFS_ALL = {
  link_validation: { items: { id: 'link_001', links: { self: '/v1/inspect/links/link_001' } } },
  image_validation: { items: { id: 'image_001', links: { self: '/v1/inspect/images/image_001' } } },
  accessibility: { items: { id: 'access_001', links: { self: '/v1/inspect/accessibility/access_001' } } },
  code_analysis: { items: { id: 'code_001', links: { self: '/v1/inspect/analyze/code_001' } } }
} as const;

// 1. Create accepted with all four checks requested.

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

// 16. Create response missing a test id; never poll or re-POST.
export const CREATE_MISSING_TEST_ID = {
  reference_id: 'lovable-build-no-id',
  warnings: []
} as const;

// Render states (GET /v2/preview/tests/{test_id}).

// 4. Render complete: all clients rendered, none processing, none bounced.
export const RENDER_COMPLETE = {
  subject: 'June campaign',
  date: 1782309720,
  completed: [CLIENT_IDS.gmail, CLIENT_IDS.outlook, CLIENT_IDS.apple],
  processing: [],
  bounced: [],
  content_checking: CHECK_REFS_ALL
} as const;

// 5. Client rendering remains in progress but does not block completed checks.
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

// 6b. A render straggler yields render_incomplete without blocking completed checks.
export const RENDER_STRAGGLER = {
  subject: 'June campaign',
  date: 1782309720,
  completed: [CLIENT_IDS.gmail, CLIENT_IDS.outlook],
  processing: [CLIENT_IDS.apple],
  bounced: [],
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

// 13. A missing requested reference is unavailable; null accessibility was not requested.
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
    code_analysis: { items: { id: 'code_013', links: { self: '/v1/inspect/analyze/code_013' } } }
  }
} as const;

// 12. Mixed lifecycle references; detail payload status decides completion.
export const RENDER_CHECK_LIFECYCLE = {
  subject: 'June campaign',
  date: 1782309720,
  completed: [CLIENT_IDS.gmail],
  processing: [],
  bounced: [],
  content_checking: {
    link_validation: { items: { id: 'link_001', links: { self: '/v1/inspect/links/link_001' } } },
    image_validation: {
      errors: [{ status: '500', title: 'processing_error', detail: 'Image validation job failed to execute.' }]
    },
    accessibility: null,
    code_analysis: { items: { id: 'code_pending', links: { self: '/v1/inspect/analyze/code_pending' } } }
  }
} as const;

// Structured-check results intentionally vary meta.status casing.

// 8. Links: 2 passes, 2 failures, and 1 informational result.
export const LINK_RESULT = {
  meta: { status: 'Completed' },
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
          { id: 'lp1', rule: 'reachable', description: 'Link resolved with 200.', details: [] },
          { id: 'lp2', rule: 'https', description: 'Link uses HTTPS.', details: [] }
        ],
        failures: [],
        informational: [
          { id: 'li1', rule: 'redirect', description: 'Link redirected once.', details: [] }
        ]
      },
      {
        url: 'https://example.com/broken',
        status: 'Error',
        status_code: 404,
        line: 20,
        column: 6,
        passes: [],
        failures: [
          { id: 'lf1', rule: 'Broken Link', description: 'Link returned 404.', impact: 'critical', details: [] },
          // Missing impact -> counts under "unknown" severity.
          { id: 'lf2', rule: 'tracking', description: 'Untracked link.', details: [] }
        ],
        informational: []
      }
    ]
  }
} as const;

// 9. Images: 1 pass, 1 moderate failure, and 1 informational result.
export const IMAGE_RESULT = {
  meta: { status: 'Complete' },
  items: {
    id: 'image_001',
    total_load_time_ms: 820,
    images: [
      {
        id: 'img1',
        url: 'https://example.com/hero.png',
        status: 'Valid',
        line: 30,
        column: 2,
        passes: [
          { id: 'ip1', rule: 'has-alt', description: 'Image has alt text.', details: [] }
        ],
        failures: [],
        informational: [
          { id: 'ii1', rule: 'dimensions', description: 'Width/height not set.', details: [] }
        ]
      },
      {
        id: 'img2',
        url: 'https://example.com/logo.gif',
        status: 'Invalid',
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

// 10. Accessibility: 3 failed instances across 2 rules; 1 review instance.
export const ACCESSIBILITY_RESULT = {
  meta: { status: 'Completed', created_at: '2026-07-10T20:16:22.663Z', updated_at: '2026-07-10T20:16:24.956Z' },
  items: [
    {
      checks: 34,
      passes: [
        { rule: 'Document Title', description: 'Document has a title.', standards: ['WCAG 2A'], pour: ['Operable'], compliance: ['2.4.2 Page Titled'] }
      ],
      failures: [
        {
          rule: 'Color Contrast',
          impact: 'serious',
          description: 'Text has insufficient contrast.',
          standards: ['WCAG 2AA'],
          pour: ['Perceivable'],
          compliance: ['1.4.3 Contrast (Minimum)'],
          instances: [
            { correctAny: ['insufficient contrast 1.09'], correctAll: [], snippet: '<h1 style="color:#fff2f0">', target: ['h1'], lineNumber: 20, absoluteIndex: 16 },
            { correctAny: ['insufficient contrast 1.42'], correctAll: [], snippet: '<p style="color:#d8d8d8">', target: ['p'], lineNumber: 21, absoluteIndex: 17 }
          ]
        },
        {
          rule: 'Image Alt',
          impact: 'critical',
          description: 'Image missing alt attribute.',
          standards: ['WCAG 2A'],
          pour: ['Perceivable'],
          compliance: ['1.1.1 Non-text Content'],
          instances: [
            { correctAny: ['no alt attribute'], correctAll: [], snippet: '<img src="logo.gif">', target: ['img'], lineNumber: 44, absoluteIndex: 25 }
          ]
        }
      ],
      needs_review: [
        {
          rule: 'Link Name',
          impact: 'moderate',
          description: 'Link text may not be descriptive.',
          standards: ['WCAG 2A'],
          pour: ['Operable'],
          compliance: ['4.1.2 Name, Role, Value'],
          instances: [
            { correctAny: ['ambiguous link text'], correctAll: [], snippet: '<a href="#">here</a>', target: ['a'], lineNumber: 60, absoluteIndex: 40 }
          ]
        }
      ]
    }
  ]
} as const;

// 11. Code analysis: 2 canonical features and 3 instances.
export const CODE_ANALYSIS_RESULT = {
  meta: {
    status: 'Completed',
    version: 1,
    count: 2,
    application_support: {
      desktop: { supported: 1, partial_support: 1, unsupported: 0, unknown: 0 },
      mobile: { supported: 2, partial_support: 0, unsupported: 0, unknown: 0 },
      web: { supported: 1, partial_support: 0, unsupported: 1, unknown: 0 }
    },
    inbox_provider_support: {
      apple_mail: { supported: 2, partial_support: 0, unsupported: 0, unknown: 0 },
      gmail: { supported: 1, partial_support: 1, unsupported: 0, unknown: 0 },
      outlook: { supported: 0, partial_support: 1, unsupported: 1, unknown: 0 }
    },
    market_support: { supported: 1, partial_support: 1, unsupported: 0, unknown: 0 }
  },
  items: {
    id: 'code_001',
    version: 1,
    features: [
      {
        slug: 'html-width',
        name: 'width attribute',
        description: 'HTML width attribute',
        category: 'html-attributes',
        notes_lookup: {},
        instances: [
          { id: 'w1', line: 14, column: 17, resolved: false },
          { id: 'w2', line: 32, column: 19, resolved: false }
        ],
        support: {
          y: [{ id: 'gmail_chrome', notes: [] }, { id: 'apple_mail', notes: [] }],
          a: [{ id: 'outlook_win', notes: ['partial in Word engine'] }],
          n: [{ id: 'lotus_notes', notes: [] }]
        }
      },
      {
        slug: 'target-attribute',
        name: 'target attribute',
        description: 'Anchor target attribute',
        category: 'html-attributes',
        notes_lookup: {},
        instances: [{ id: 't1', line: 60, column: 8, resolved: false }],
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

// 11b. Processing code analysis has no final counts.
export const CODE_ANALYSIS_PROCESSING = {
  meta: { status: 'Processing', version: 1 },
  items: { id: 'code_pending', version: 1, features: [] }
} as const;

// Client render detail, not fetched by the composite workflow.
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

// 18. API error bodies (Mailgun surfaces `message`; some endpoints use `Reason`).

export const API_ERROR_401 = { message: 'Invalid private key' } as const;
export const API_ERROR_403 = { message: 'Email Preview is not enabled for this account' } as const;
export const API_ERROR_429 = { message: 'Too many requests. Preview quota exceeded.' } as const;
export const API_ERROR_5XX = { message: 'Internal server error' } as const;

// Behavioral markers shared with mailgun-cli.

// 14. A detail 404 becomes an unavailable data gap without retry.
export const CHECK_RESULT_404 = {
  scenario: 'unexpected_structured_check_404',
  status_code: 404,
  path: '/v1/inspect/analyze/code_pending',
  expected_lifecycle: 'unavailable',
  expected_data_gap_code: 'result_endpoint_unavailable'
} as const;

// 15. A processing check reaches the deadline and returns latest evidence without re-creation.
export const POLL_DEADLINE_REACHED = {
  scenario: 'poll_deadline_reached',
  check_snapshot: 'CODE_ANALYSIS_PROCESSING',
  expected_timed_out: true,
  expected_data_gap_code: 'workflow_timed_out'
} as const;

// 17. Ambiguous creation requires reconciliation by reference id; never re-POST.
export const AMBIGUOUS_CREATE_TRANSPORT_FAILURE = {
  scenario: 'ambiguous_create_transport_failure',
  reference_id: 'lovable-build-123',
  expected_error: true,
  expected_recovery: 'list_preview_tests',
  must_not_retry_post: true
} as const;
