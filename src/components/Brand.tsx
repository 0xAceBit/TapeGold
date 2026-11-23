import { Avatar } from './Portrait';

/** The wordmark with a small round portrait beside it. */
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Avatar size={small ? 30 : 38} />
      <span className="display" style={{ fontSize: small ? 18 : 22, fontWeight: 500 }}>
        TapeGold<span className="serif" style={{ color: 'var(--subtle)', marginLeft: 3, fontSize: small ? 16 : 20 }}>golf</span>
      </span>
    </span>
  );
}
