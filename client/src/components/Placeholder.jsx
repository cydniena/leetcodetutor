// Honest stub for a route whose slice is not built yet.
export default function Placeholder({ title, phase, children }) {
  return (
    <div className="card">
      <h1>{title}</h1>
      <p className="alert info">Not built yet — arrives in phase {phase}.</p>
      {children}
    </div>
  );
}
