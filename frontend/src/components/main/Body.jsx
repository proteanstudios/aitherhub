export default function Body({ children }) {
  return (
    <main className="flex-1 px-6 overflow-auto md:overflow-auto">
      {children}
    </main>
  );
}