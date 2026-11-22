import { Link } from 'react-router-dom';

// The red dot is the camera tally light. It is the only decorative element in the product.
export default function Wordmark() {
  return (
    <Link to="/" className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
      <span className="h-2.5 w-2.5 rounded-full bg-tally" aria-hidden="true" />
      MeetSpace
    </Link>
  );
}