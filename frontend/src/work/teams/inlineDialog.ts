// Whether a people dialog draws in place rather than as a pop-up of its own.
//
// The Admin window shows "Add a person", "Invite" and "Import" inside itself, full size, with its
// own title and close button. The same dialogs still open as pop-ups everywhere else (the People
// directory, a person's panel), so they read this rather than being written twice.
import { createContext } from 'react';

export const DrawInPlace = createContext(false);
