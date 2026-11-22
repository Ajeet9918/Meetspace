export default function FormError({ children }) {
  if (!children) return null;
  return <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">{children}</p>;
}