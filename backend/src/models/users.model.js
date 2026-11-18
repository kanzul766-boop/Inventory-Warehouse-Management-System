import mongoose from "mongoose"

export const USER_ROLES = Object.freeze([
    "admin",
    "warehouseManager",
    "supplier",
    "salesRepresentative"
])

const userSchema= new mongoose.Schema({
    name: {
        type: String,
        trim: true,
        maxlength: 100
    },
    username:{
        type: String,
        unique: true,
        required:true,
        trim:true,
        maxlength:50
    },
    email:  {
        type: String,
        unique: true,
        required:true,
        trim:true,
        lowercase:true,
        maxlength:254,
        match:/^[^\s@]+@[^\s@]+\.[^\s@]+$/
    },
    password: {
        type: String,
        required:true,
        select:false
    },
    role:{
        type: String,
        default: "salesRepresentative",
        enum:USER_ROLES
    },
    phone: {
        type: String,
        trim: true,
        maxlength: 30
    },
    assignedWarehouses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "warehouse"
    }],
    image: {
        type: String,
        trim: true
    },
    imageFileId: {
        type: String,
        trim: true
    },
    companyName: {
        type: String,
        trim: true,
        maxlength: 200
    },
    logoUrl: {
        type: String,
        trim: true
    },
    logoFileId: {
        type: String,
        trim: true
    },
    cart:[{
        product:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"product",
            required:true
        },
        quantity:{
            type:Number,
            required:true,
            min:1,
            default:1
        }
    }]
})
const userModel = mongoose.model("user",userSchema)
export default userModel
