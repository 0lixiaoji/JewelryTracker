interface Props {
  text?: string;
}

export default function LoadingSpinner({ text = '加载中…' }: Props) {
  return (
    <div className="status-msg">
      <div className="spinner" />
      <p>{text}</p>
    </div>
  );
}
