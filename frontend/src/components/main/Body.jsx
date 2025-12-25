export default function Body({ children }) {
  return (
    <main className="flex-1 p-6 overflow-hidden">
      {children}
    </main>
  );
}