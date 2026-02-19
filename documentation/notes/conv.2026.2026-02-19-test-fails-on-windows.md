---
id: e3w5ffoprxq5mpjh51vglgd
title: 2026 02 19 Test Fails on Windows
desc: ''
updated: 1771497563098
created: 1771497563098
---

# User_2026-02-19_0239_43

we've got one test that apparently fails on windows, but not on wsl:

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/e2e-export.test.ts > end-to-end export > parses a JSONL fixture and exports correct markdown
AssertionError: expected '---\nid: -u2ugUP8lp\ntitle: Auth Disc…' to match /id: \w+/

- Expected:
/id: \w+/

+ Received:
"---
id: -u2ugUP8lp
title: Auth Discussion
desc: \"\"
created: 1771497439560
updated: 1771497439560
---

# Dave_2026-02-10_1536_18

*I want to add authentication to my app. Can you help?*

# claude-opus-4.6_2026-02-10_1536_25

I'd be happy to help with authentication! Let me check your project structure first.

I can see you're using Express but don't have any auth yet. I'd recommend using Passport.js with JWT tokens.

<details>
<summary>Tool Calls</summary>

**Read**: /home/user/project/package.json

```
{
  \"name\": \"my-app\",
  \"dependencies\": { \"express\": \"^4.18.0\" }
}
```

**Grep**: auth|login|session

```
No matches found.
```

</details>

<details>
<summary>Thinking</summary>

The user wants auth. Let me check what framework they're using.

</details>

# Dave_2026-02-10_1540_12

*Sounds good, let's go with Passport.js. Can you set it up?*

# claude-opus-4.6_2026-02-10_1540_15

I'll set up Passport.js with JWT authentication for your Express app.
"

 ❯ tests/e2e-export.test.ts:50:23
     48|       expect(content).toMatch(/^---\n/);
     49|       expect(content).toContain("title: Auth Discussion");
     50|       expect(content).toMatch(/id: \w+/);
       |                       ^
     51|
     52|       // User message — italicized with custom name

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 6 passed (7)
      Tests  1 failed | 72 passed (73)
   Start at  02:37:17
   Duration  2.13s (transform 1.06s, setup 0ms, import 7.13s, tests 252ms, environment 1ms)

 ELIFECYCLE  Test failed. See above for more details.

::capture @documentation/notes/conv.2026.2026-02-19-test-fails-on-windows.md

# claude-sonnet-4.6_2026-02-19_0239_50

Let me look at the failing test and the ID generation code.


# claude-sonnet-4.6_2026-02-19_0240_08

The issue is clear. The regex `/id: \w+/` only matches word characters (letters, digits, underscore), but `nanoid` can generate IDs that start with a hyphen (e.g., `-u2ugUP8lp`). The test is non-deterministic — it passes on WSL only because nanoid happened not to generate a hyphen-prefixed ID there.

The fix is to update the regex to also allow hyphens:



# claude-sonnet-4.6_2026-02-19_0241_07

Tests pass now. The root cause was that `nanoid`'s URL-safe alphabet includes `-`, so IDs can start with a hyphen. The regex `/id: \w+/` failed because `\w` doesn't match `-`. Changing it to `/id: [\w-]+/` handles all valid nanoid output.
