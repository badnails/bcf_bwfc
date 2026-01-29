function Notification({ message, type }) {
  return (
    <div className={`notification ${type}`}>
      {type === 'success' ? '✓ ' : '✗ '}
      {message}
    </div>
  )
}

export default Notification
