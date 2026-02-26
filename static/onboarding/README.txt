Onboarding Content Structure

Place onboarding content in role folders under static/onboarding.

Role folders:
- member
- maintainer
- manager

Each onboarding page must be its own folder inside the role folder.
Example:
static/onboarding/member/01-month-picker/

Inside each page folder:
- content.txt (required):
  - line 1 = page title
  - remaining lines = description text
- one image file (optional but recommended):
  - image.png, image.jpg, image.jpeg, image.webp, image.gif, image.avif, or image.svg

Example:
static/onboarding/member/01-month-picker/content.txt
static/onboarding/member/01-month-picker/image.png

Page folders are displayed in alphabetical order.
Use numeric prefixes (01-, 02-, etc.) to control sequence.
