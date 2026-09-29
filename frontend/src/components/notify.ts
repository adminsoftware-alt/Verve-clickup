// Telling someone something went wrong, without an operating-system dialog.
//
// Twenty-five places called `window.alert()`. That draws a grey Windows box with the domain name
// in its title bar and an OK button, it blocks the page until it is dismissed, and it is the one
// thing on screen that cannot be styled at all. Nothing else made the app look less like a
// product.
//
// react-hot-toast was already installed and mounted; it was simply never used outside the old
// v1 pages.
import toast from 'react-hot-toast';

/** Whatever was thrown, as something worth reading. */
export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Something went wrong. Try again.';
}

export const notify = {
  /** It worked, and the person may not otherwise be able to tell. */
  ok: (message: string) => toast.success(message),
  /** It did not work. Longer on screen than a success, because it has to be read. */
  error: (error: unknown) => toast.error(messageOf(error), { duration: 6000 }),
  /** Neither; just something they should know. */
  info: (message: string) => toast(message),
};
