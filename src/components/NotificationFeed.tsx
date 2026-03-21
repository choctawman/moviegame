import { Card } from "@/components/Card";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleString();
}

export function NotificationFeed({
  title,
  notifications,
}: {
  title: string;
  notifications: NotificationItem[];
}) {
  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {notifications.length === 0 ? (
        <p className="text-sm text-slate-500">No notifications yet.</p>
      ) : (
        <ul className="space-y-2">
          {notifications.map((notification) => (
            <li key={notification.id} className="rounded-lg bg-slate-50 p-2">
              <p className="text-sm font-semibold">{notification.title}</p>
              <p className="whitespace-pre-line text-sm text-slate-700">{notification.body}</p>
              <p className="text-xs text-slate-500">{formatDateTime(notification.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
