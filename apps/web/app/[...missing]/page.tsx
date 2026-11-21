// Any URL no other route matches (audit run 3, 3-b). Next's built-in 404 for unmatched routes hydrated with a
// mismatch at <main> on slow connections (React #418, about 1 in 10 loads); notFound() from a real route doesn't.
import { notFound } from "next/navigation";

export default function Missing() {
  notFound();
}
