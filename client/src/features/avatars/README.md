# avatars

Avatar library: list, edit, delete.

`AvatarDetail` (`/avatars/:id`) is one avatar's page, laid out like LemonSlice's agent page: Chat (a live call, via `features/call/useCall`) and Settings (`AvatarSettings` - visuals, greeting, voice, personality, behaviour). Settings are saved with the Save button in the header through `useManualSave`; nothing is sent until it is pressed, and leaving or closing the page with unsaved changes asks first.

`KnowledgeBase` is the Personality card's document list: PDF, DOCX, TXT or MD, uploaded straight away rather than through Save. The server keeps only the extracted text and adds it to the call's instructions (`server/src/ai/knowledge.js` has the size and context budgets).
