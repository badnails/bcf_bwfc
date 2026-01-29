import { useState, useEffect } from 'react'
import ProductList from './components/ProductList'
import OrderHistory from './components/OrderHistory'
import Notification from './components/Notification'

// API base URLs - using Vite proxy
const ORDER_SERVICE_URL = '/api'
const INVENTORY_SERVICE_URL = '/inventory-api'

function App() {
  const [activeTab, setActiveTab] = useState('products')
  const [userId, setUserId] = useState('demo-user-001')
  const [products, setProducts] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState(null)

  // Show notification
  const showNotification = (message, type = 'success') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 4000)
  }

  // Fetch products from inventory service
  const fetchProducts = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${INVENTORY_SERVICE_URL}/inventory`)
      if (!response.ok) throw new Error('Failed to fetch products')
      const data = await response.json()
      setProducts(data.products || [])
    } catch (error) {
      console.error('Error fetching products:', error)
      showNotification('Failed to load products. Make sure services are running.', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Fetch orders from order service
  const fetchOrders = async () => {
    if (!userId.trim()) return
    setLoading(true)
    try {
      const response = await fetch(`${ORDER_SERVICE_URL}/orders?user_id=${encodeURIComponent(userId)}`)
      if (!response.ok) throw new Error('Failed to fetch orders')
      const data = await response.json()
      setOrders(data.orders || [])
    } catch (error) {
      console.error('Error fetching orders:', error)
      showNotification('Failed to load orders. Make sure services are running.', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Place an order
  const placeOrder = async (productId, quantity) => {
    if (!userId.trim()) {
      showNotification('Please enter a User ID', 'error')
      return
    }

    try {
      const response = await fetch(`${ORDER_SERVICE_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': crypto.randomUUID(),
          'X-Correlation-ID': crypto.randomUUID(),
        },
        body: JSON.stringify({
          user_id: userId,
          product_id: productId,
          quantity: parseInt(quantity),
        }),
      })

      const data = await response.json()

      if (response.ok) {
        if (data.status === 'confirmed') {
          showNotification(`Order confirmed! Order ID: ${data.order_id}`, 'success')
          // Refresh products to show updated stock
          fetchProducts()
        } else {
          showNotification(`Order failed: ${data.message}`, 'error')
        }
      } else if (response.status === 503) {
        showNotification(`Service timeout. Order ID: ${data.order_id}. Please retry.`, 'error')
      } else {
        showNotification(data.error?.message || 'Order failed', 'error')
      }
    } catch (error) {
      console.error('Error placing order:', error)
      showNotification('Failed to place order. Check your connection.', 'error')
    }
  }

  // Load data on mount and tab change
  useEffect(() => {
    if (activeTab === 'products') {
      fetchProducts()
    } else if (activeTab === 'orders') {
      fetchOrders()
    }
  }, [activeTab])

  // Refetch orders when user ID changes
  useEffect(() => {
    if (activeTab === 'orders' && userId.trim()) {
      fetchOrders()
    }
  }, [userId])

  return (
    <div className="app">
      {notification && (
        <Notification message={notification.message} type={notification.type} />
      )}

      <header>
        <h1>🛒 Valerix E-Commerce</h1>
        <p>Microservices Demo - Order & Inventory System</p>
      </header>

      <div className="user-info">
        <label htmlFor="userId">👤 User ID:</label>
        <input
          type="text"
          id="userId"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="Enter your user ID"
        />
      </div>

      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === 'products' ? 'active' : ''}`}
          onClick={() => setActiveTab('products')}
        >
          📦 Products
        </button>
        <button
          className={`tab-btn ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => setActiveTab('orders')}
        >
          📋 My Orders
        </button>
      </div>

      <div className="content">
        {activeTab === 'products' ? (
          <ProductList
            products={products}
            loading={loading}
            onOrder={placeOrder}
            onRefresh={fetchProducts}
          />
        ) : (
          <OrderHistory
            orders={orders}
            loading={loading}
            onRefresh={fetchOrders}
          />
        )}
      </div>
    </div>
  )
}

export default App
