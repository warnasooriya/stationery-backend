# Stationery Inventory Backend

Backend API server for the Stationery Inventory Management System, built with Node.js, Express, and MongoDB.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (JSON Web Tokens)
- **Validation**: Zod
- **Excel Export**: xlsx

## Project Structure

```
stationery-backend/
├── src/
│   ├── middleware/
│   │   └── auth.js          # JWT authentication middleware
│   ├── models/
│   │   ├── Employee.js      # Employee schema
│   │   ├── Issuance.js      # Issuance/Outgoing schema
│   │   ├── Item.js          # Item schema
│   │   ├── Purchase.js      # Purchase/Incoming schema
│   │   └── User.js          # User schema with password hashing
│   ├── routes/
│   │   ├── dashboard.js     # Dashboard stats endpoints
│   │   ├── employees.js     # Employee CRUD
│   │   ├── export.js        # Excel export endpoints
│   │   ├── issuances.js     # Issuance CRUD
│   │   ├── items.js         # Item CRUD
│   │   ├── purchases.js     # Purchase CRUD
│   │   └── users.js         # User auth & management
│   ├── services/
│   │   └── inventory.js     # Stock calculation business logic
│   ├── utils/
│   │   └── xlsx.js          # Excel export utilities
│   ├── db.js                # MongoDB connection
│   └── index.js             # Application entry point
├── .env.example             # Environment variables template
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+ installed
- MongoDB (local installation or MongoDB Atlas cluster)

### MongoDB Setup

#### Option 1: Local MongoDB

1. Install MongoDB locally
2. Start MongoDB service
3. Connection string format: `mongodb://localhost:27017/stationery_inventory`

#### Option 2: MongoDB Atlas (Recommended)

1. Sign up at [https://www.mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Create a new cluster
3. Configure IP whitelist (add your current IP or 0.0.0.0/0 for development)
4. Create a database user with read/write access
5. Get your connection string from Atlas dashboard

Connection string format:
```
mongodb+srv://<username>:<password>@<cluster-url>/stationery_inventory?retryWrites=true&w=majority
```

#### Current Mongodb Account
- **Email**: `warnasooriyaravi@gmail.com`

### Installation

1. Navigate to backend directory:
```bash
cd stationery-backend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:

```env
# Server Port
PORT=4000

# MongoDB Connection URI
# Local: mongodb://localhost:27017/stationery_inventory
# Atlas: mongodb+srv://<username>:<password>@cluster0.xxx.mongodb.net/stationery_inventory?retryWrites=true&w=majority
MONGO_URI=mongodb://localhost:27017/stationery_inventory

# Frontend URL for CORS
FRONTEND_ORIGIN=http://localhost:3000

# JWT Secret Key (generate a strong secret for production)
JWT_SECRET=your-super-secret-key-change-in-production

# Default Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

### Running the Application

**Development mode (with hot reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The server will start on `http://localhost:4000` by default.

## Default Admin User

On first startup, the system automatically creates a default admin user:
- **Username**: `admin`
- **Password**: `admin123` (or what you set in ADMIN_PASSWORD)

**Important:** Change the default password after first login!

## API Endpoints

### Authentication
- `POST /api/users/login` - User login

### Protected Routes (requires JWT token)
- `GET /api/dashboard/stats` - Get dashboard statistics
- `GET /api/items` - List all items
- `POST /api/items` - Create new item
- `PUT /api/items/:id` - Update item
- `DELETE /api/items/:id` - Delete item
- `GET /api/purchases` - List purchases
- `POST /api/purchases` - Create purchase
- `GET /api/issuances` - List issuances
- `POST /api/issuances` - Create issuance
- `GET /api/employees` - List employees
- `POST /api/employees` - Create employee
- `GET /api/users` - List users (admin only)
- `POST /api/users` - Create user (admin only)

## Security Notes

- Never commit `.env` file to version control
- Use strong JWT_SECRET in production
- Configure proper CORS origin in production
- Set up IP whitelisting for MongoDB Atlas
- Use HTTPS in production environments
