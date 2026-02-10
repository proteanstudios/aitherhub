export default function Body({ children }) {
  return (
    <main className="flex-1 flex items-center justify-center px-6 overflow-auto md:overflow-auto">
      {children}
    </main>
  );
}