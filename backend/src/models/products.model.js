import mongoose from "mongoose"

const productSchema= new mongoose.Schema({
    image:{
        type: String,
        required:true
    },
    imageUrl: {
        type: String,
        trim: true
    },
    imageFileId: {
        type: String,
        trim: true
    },
    name:  {
        type: String,
        required:true,
        trim: true,
        maxlength: 150
    },
    desc: {
        type: String,
        required:true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    sku: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 64
    },
    category: {
        type: String,
        trim: true,
        maxlength: 100
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    lowStockLimit: {
        type: Number,
        default: 10,
        min: 0,
        validate: Number.isSafeInteger
    },
    supplier: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user"
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user"
    },
    admin:{
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required:true
    }
}, { timestamps: true })

productSchema.index({ sku: 1 }, { unique: true, sparse: true })
productSchema.index({ supplier: 1, name: 1 })

const productModel = mongoose.model("product",productSchema)
export default productModel
