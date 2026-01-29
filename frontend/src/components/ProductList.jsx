import { useState } from 'react'

function ProductList({ products, loading, onOrder, onRefresh }) {
  const [quantities, setQuantities] = useState({})
  const [ordering, setOrdering] = useState(null)

  const getStockClass = (stockLevel) => {
    if (stockLevel === 0) return 'out-of-stock'
    if (stockLevel <= 10) return 'low-stock'
    return 'in-stock'
  }

  const getStockText = (stockLevel) => {
    if (stockLevel === 0) return 'Out of Stock'
    if (stockLevel <= 10) return `Low Stock: ${stockLevel}`
    return `In Stock: ${stockLevel}`
  }

  const handleQuantityChange = (productId, value) => {
    setQuantities((prev) => ({
      ...prev,
      [productId]: Math.max(1, parseInt(value) || 1),
    }))
  }

  const handleOrder = async (productId) => {
    const quantity = quantities[productId] || 1
    setOrdering(productId)
    await onOrder(productId, quantity)
    setOrdering(null)
  }

  if (loading) {
    return <div className="loading">Loading products...</div>
  }

  if (products.length === 0) {
    return (
      <div className="empty-state">
        <div>📦</div>
        <p>No products available</p>
        <button className="refresh-btn" onClick={onRefresh} style={{ marginTop: '15px' }}>
          Refresh
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="section-header">
        <h2>Available Products</h2>
        <button className="refresh-btn" onClick={onRefresh}>
          🔄 Refresh
        </button>
      </div>

      <div className="products-grid">
        {products.map((product) => (
          <div key={product.product_id} className="product-card">
            <h3>{product.name}</h3>
            <p className="product-id">ID: {product.product_id}</p>

            <div className="stock-info">
              <span className={`stock-level ${getStockClass(product.available_stock)}`}>
                {getStockText(product.available_stock)}
              </span>
            </div>

            <div className="order-form">
              <input
                type="number"
                min="1"
                max={product.available_stock}
                value={quantities[product.product_id] || 1}
                onChange={(e) => handleQuantityChange(product.product_id, e.target.value)}
                disabled={product.available_stock === 0 || ordering === product.product_id}
              />
              <button
                className="order-btn"
                onClick={() => handleOrder(product.product_id)}
                disabled={product.available_stock === 0 || ordering === product.product_id}
              >
                {ordering === product.product_id ? 'Ordering...' : 'Order Now'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export default ProductList
