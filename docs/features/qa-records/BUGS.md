# BUGS.md — QA Bug Criteria

Source: **Bug Clarifications v2.0** (Nov 5, 2026). Approved by Victor M.

This file lists the bug criteria used to classify each QA. Each bug has a severity (Opportunity, Failed or Critical) and a check type:

- **Tool**: checked automatically by QA API Tester.
- **Manual**: checked by the QA Shadow in the manual checklist (Passed / Bug / N/A).

The column **"Tool today"** shows what QA API Tester already checks in its current version, so we know what needs to be added.

---

## General rules

- **No bug applies:** if we identify that the Specialist, PM or end client has made changes to a page that is being reviewed.
- **N/A:** if a case is marked as Failed or Critical but the issue was outside the scope of the original request, it can be marked as "N/A" with a brief explanation.
- The goal is to be proactive and help identify issues, even when they are outside the original scope of the request.

## Severity levels

| Severity        | Definition                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Opportunity** | Low severity. An opportunity for improvement that does not significantly impact functionality or design.          |
| **Failed**      | Medium severity. Technical or configuration errors that affect SEO, navigation or functionality.                  |
| **Critical**    | High severity. The deliverable does not meet the client's requirements. It is the first thing the client notices. |

---

## Summary

| ID      | Bug                                                      | Type         | Severity    | Tool today | Check type           |
| ------- | -------------------------------------------------------- | ------------ | ----------- | ---------- | -------------------- |
| OPP-01  | Margins and paddings                                     | Styling      | Opportunity | No         | _To decide_          |
| OPP-02  | Visual styling (colors, gradients, CTAs, links, content) | Styling      | Opportunity | No         | _To decide_          |
| FAIL-01 | Cropped images                                           | Styling      | Failed      | No         | _To decide_          |
| FAIL-02 | Image attributes: src                                    | Images       | Failed      | Yes        | Tool                 |
| FAIL-03 | Image attributes: title                                  | Images       | Failed      | Yes        | Tool                 |
| FAIL-04 | Image attributes: alt                                    | Images       | Failed      | Yes        | Tool                 |
| FAIL-05 | Relative link                                            | Links        | Failed      | Yes        | Tool                 |
| FAIL-06 | Broken links                                             | Links        | Failed      | Yes        | Tool                 |
| FAIL-07 | Links not verified                                       | Links        | Failed      | Yes        | Tool                 |
| FAIL-08 | Anchors not configured in Composer                       | Anchors      | Failed      | Yes        | Tool                 |
| FAIL-09 | Relative path with anchor                                | Anchors      | Failed      | Partial    | Tool                 |
| FAIL-10 | Double H1 tags                                           | H1           | Failed      | Yes        | Tool                 |
| FAIL-11 | Incorrect H1 page title                                  | H1           | Failed      | No         | _To decide_          |
| FAIL-12 | Inventory: wrong number of vehicles                      | Inventory    | Failed      | No         | _To decide_          |
| FAIL-13 | Inventory: wrong vehicle inventory                       | Inventory    | Failed      | No         | _To decide_          |
| FAIL-14 | Inventory: wrong inventory style                         | Inventory    | Failed      | No         | _To decide_          |
| FAIL-15 | Sitemap XML/HTML not enabled                             | SEO          | Failed      | No         | _To decide_          |
| FAIL-16 | Lead source: incorrect Source field in forms             | Forms        | Failed      | No         | _To decide_          |
| FAIL-17 | FAQ Schema                                               | SEO          | Failed      | No         | Schema.org validator |
| CRIT-01 | Missing copy                                             | Copy         | Critical    | Yes        | Tool                 |
| CRIT-02 | Wrong copy                                               | Copy         | Critical    | Partial    | Tool + Manual        |
| CRIT-03 | Instructions not followed                                | Instructions | Critical    | No         | _To decide_          |

"Tool today" reflects the latest version of QA API Tester. FAIL-17 uses the Schema.org validator, as the source document indicates.

**Type** is the bug category used in the QA comment, one line per bug: `Device / Type / Severity / Description` (for example, `M/D / Styling / Failed / Cropped images`). Types: Styling, Images, Links, Anchors, H1, Inventory, SEO, Forms, Copy, Instructions.

---

## Opportunity

For very specific requests on an existing page, such as "Update the FAQ section", there may be errors in other sections of the page. These issues should be marked as **Opportunities**. In these situations:

- **Fix** the issue if it is obvious and easy to resolve.
- **Notify the specialist** about any existing issues so they can decide whether they should be corrected.

### OPP-01 — Margins and paddings

- Too little space or too much space.

### OPP-02 — Visual styling

- Something that affected the visual styling, such as colors, gradients or other design elements (CTAs, links, content).

---

## Failed

### FAIL-01 — Cropped images

- **Bug applies:** in all images, the vehicles appear cut off.
- **No bug applies:** when other objects (people, finance, service) are partially cropped, as long as the overall image and vehicle still look visually good.

### FAIL-02 — Image attributes: src

- Does not belong to the dealer account.
- Empty source.
- **Bug applies:** to all widgets that use images.
- **Tool today:** checked by QA API Tester.

### FAIL-03 — Image attributes: title

- Missing title attribute.
- Empty title attribute.
- Title does not match the image.
- **Bug applies:** to Content widgets and raw widgets.
- **No bug applies:** to Image widgets and backgrounds.
- **Tool today:** checked by QA API Tester.

### FAIL-04 — Image attributes: alt

- Missing title attribute.
- Empty title attribute.
- Title does not match the image.
- **Bug applies:** to Content widgets, raw widgets, image widget.
- **No bug applies:** to backgrounds, Posting cases.
- **Tool today:** checked by QA API Tester.

> Note: the source document says "title" in this section. To confirm whether it means the **alt** attribute.

### FAIL-05 — Relative link

_Source note: We should use the QA tool._

- We always try to use relative paths.
- **Bug applies:** when we use an absolute URL that points to a page within the dealer's website.
- **No bug applies:** when the absolute URL does not belong to the dealer's website.
- **Tool today:** checked by QA API Tester.

### FAIL-06 — Broken links

_Source note: We should use the QA tool._

- Error 404.
- Empty href attribute.
- **Bug applies:** always.
- **Tool today:** checked by QA API Tester.

### FAIL-07 — Links not verified

_Source note: We should use the QA tool._

- We should verify two sections on WOMs: "Links" and "Call to Action".
- **Bug applies:**
  - If a link from the "Links" section is missing, notify the specialist via Slack or WOMS comment.
  - If the missing link is from the "CTAs" section.
- **No bug applies:** when the required link is broken.
- **Tool today:** "Links to Check" confirms whether each requested link is present on the page (IN PAGE / NOT FOUND).

### FAIL-08 — Anchors not configured in Composer

_Source note: We should use the QA tool._

- **Bug applies:** when an anchor link does not redirect to the corresponding section configured in Composer.
- **Tool today:** anchor validation confirms that the target section exists on the page.

### FAIL-09 — Relative path with anchor

_Source note: We should use the QA tool._

- **Bug applies:** when a relative path is combined with an anchor in the same URL.
- **Tool today:** lists anchors that point to another address as "misconfigured". To confirm if this covers the rule.

### FAIL-10 — Double H1 tags

_Source note: We should use the QA tool. H1 tags with sr-only also count as H1 tags._

- **Bug applies:** when a page contains two or more different H1 tags.
- **No bug applies:**
  - When a page contains multiple H1 tags with identical text.
  - When additional H1 tags come from generic inherited Composer widgets that are outside the scope of our edits.
- **Tool today:** checked by QA API Tester.

### FAIL-11 — Incorrect H1 page title

- **Bug applies:** when the page title does not match the page content, such as when the title mentions a different year than the one shown in the content.
- **No bug applies:** when the title is properly formatted and relevant to the page content. The title does not necessarily have to match the exact wording provided in the ticket.

### FAIL-12 — Inventory: wrong number of vehicles

- **Bug applies:** when the number of vehicles displayed does not match the number of new or used inventory.
- **No bug applies:**
  - When the request is only about a specific location on the page.
  - When the page already has an inventory configuration applied.

### FAIL-13 — Inventory: wrong vehicle inventory

- **Bug applies:** when the inventory widget displays vehicles that do not match the requested inventory filters.

### FAIL-14 — Inventory: wrong inventory style

- List/grid, Tabs, Wide.
- **Bug applies:** when the inventory widget uses a different display style than the new or used inventory.
- **No bug applies:** when the request specifies a particular inventory style.

### FAIL-15 — Sitemap XML/HTML not enabled

- **Bug applies:** when the XML and HTML sitemap checkboxes are not enabled.
- **No bug applies:** when the XML and HTML sitemap checkboxes are not displayed or available.

### FAIL-16 — Lead source: incorrect Source field in forms

- **Bug applies:**
  - When the Source field does not match the current page title and still displays the title it was copied from.
  - When a specific email address is provided in the request but is not configured in Lead Distribution.
- **No bug applies:** when the Source field is General.

### FAIL-17 — FAQ Schema

_Source note: We should use Schema Org Tool (https://validator.schema.org/)._

- **Bug applies:** when the ticket requests a FAQ Schema and it has not been added correctly.

---

## Critical

### CRIT-01 — Missing copy

_Source note: if the draft has been deleted, contact the teammate who originally made the page directly._

- **Bug applies:** when the page content is incomplete or some of the requested copy is missing.
- **No bug applies:**
  - When the specialist has updated the content and the changes are already reflected on the live site.
  - When the draft has been deleted for any reason.
- **Tool today:** compares the page content with the CO line by line and reports missing and partial lines.

### CRIT-02 — Wrong copy

- **Bug applies:** when the page content is not relevant to the URL path, page title or WOM ticket requirements.
- **Tool today:** partially checked by QA API Tester; the rest is checked manually.

### CRIT-03 — Instructions not followed

- **Bug applies:** when a DDC team member fails to follow the instructions specified in the WOM ticket that fall within our scope of work. For example:
  - Mimic page
  - Copy page design
  - Add to navigation
- **No bug applies:** when the requirement falls outside our scope of work.
