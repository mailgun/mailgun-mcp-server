# Preflight profiles reference

Profiles are this skill's internal routing vocabulary for choosing `content_checks` and a client strategy. They are skill policy, not MCP schema: the MCP tools only see the explicit `content_checks` and `clients` parameters you pass. Accept profile names when users offer them, but never require users to learn this vocabulary.

## Profiles

| Profile             | Explicit `content_checks`                   | `clients`                                                    |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `quick`             | `link_validation`, `image_validation`       | Omit for Mailgun defaults                                    |
| `accessibility`     | `accessibility`, `code_analysis`            | Omit for Mailgun defaults                                    |
| `full`              | All four checks                             | Omit for Mailgun defaults                                    |
| `audience-specific` | All four unless the user requests otherwise | Resolve explicit named platforms with `list_preview_clients` |

## Selection rules

- An unqualified preflight ("preflight this email", "test this before we send") uses `full`.
- Map intent to the nearest profile: "just check the links and images" is `quick`; "is this accessible?" is `accessibility`; "how does this look for our Outlook-heavy audience?" is `audience-specific`.
- Always pass the profile's checks explicitly in `content_checks`. Do not rely on the MCP's default check selection, even for `full`.
- State the selected profile, its checks, and the client strategy before or with the result, for example: "Ran the full profile (all four checks) against the Mailgun default client set."

## Client strategy

- Omit `clients` entirely to use the Mailgun default client set. Never pass an empty list.
- When the user names specific platforms (for example "Outlook and Apple Mail"), call `list_preview_clients` and select the matching client ids. Pass those ids exactly as returned.
- When the user describes an audience vaguely (for example "mostly corporate desktop users"), state the assumption, propose a narrower client set, and keep Mailgun defaults unless the user accepts the narrower selection. Acceptance of a client set is not create authorization by itself; the create still needs explicit operational intent.
- If the result's `warnings` show invalid or unrecognized clients, surface them as-is. Offer a corrected selection for a future test rather than rerunning.
