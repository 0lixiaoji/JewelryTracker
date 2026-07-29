import { useNotification } from '../contexts/NotificationContext';

export default function NotificationToast() {
  const { notifications, dismiss } = useNotification();

  if (notifications.length === 0) return null;

  return (
    <div className="toast-container">
      {notifications.map((n) => (
        <div key={n.id} className={`toast toast-${n.type}`}>
          <span>{n.message}</span>
          <button onClick={() => dismiss(n.id)}>&times;</button>
        </div>
      ))}
    </div>
  );
}
