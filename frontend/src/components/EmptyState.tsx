interface Props {
  icon?: string;
  message: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon = '📭', message, action }: Props) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <p>{message}</p>
      {action && (
        <button onClick={action.onClick} className="btn-outline">
          {action.label}
        </button>
      )}
    </div>
  );
}
