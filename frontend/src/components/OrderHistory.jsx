function OrderHistory({ orders, loading, onRefresh }) {
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString()
  }

  if (loading) {
    return <div className="loading">Loading orders...</div>
  }

  return (
    <>
      <div className="section-header">
        <h2>Order History</h2>
        <button className="refresh-btn" onClick={onRefresh}>
          🔄 Refresh
        </button>
      </div>

      {orders.length === 0 ? (
        <div className="empty-state">
          <div>📋</div>
          <p>No orders yet. Start shopping!</p>
        </div>
      ) : (
        <div className="orders-list">
          {orders.map((order) => (
            <div key={order.order_id} className="order-card">
              <div className="order-info">
                <h4>Order #{order.order_id}</h4>
                <p>
                  <strong>Product:</strong> {order.product_id} &nbsp;|&nbsp;
                  <strong>Quantity:</strong> {order.quantity}
                </p>
                <p>
                  <strong>Placed:</strong> {formatDate(order.placed_at)}
                </p>
                {order.error_message && (
                  <p style={{ color: '#c62828', marginTop: '5px' }}>
                    <strong>Error:</strong> {order.error_message}
                  </p>
                )}
              </div>
              <span className={`order-status ${order.status}`}>
                {order.status === 'confirmed' ? '✓ Confirmed' : '✗ Failed'}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default OrderHistory
