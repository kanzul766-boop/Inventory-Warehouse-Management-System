import mongoose from "mongoose";

const warehouseSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    code: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        unique: true,
        maxlength: 30
    },
    address: {
        type: String,
        required: true,
        trim: true,
        maxlength: 500
    },
    location: {
        type: String,
        trim: true,
        maxlength: 500
    },
    manager: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user"
    },
    capacity: {
        type: Number,
        min: 0,
        validate: Number.isSafeInteger
    },
    managers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "user"
    }]
}, { timestamps: true });

warehouseSchema.pre("validate", function() {
    if (!this.location && this.address) this.location = this.address;
    if (!this.address && this.location) this.address = this.location;
    if (this.manager && !this.managers.some(id => id.toString() === this.manager.toString())) {
        this.managers.push(this.manager);
    }
    if (!this.manager && this.managers.length === 1) this.manager = this.managers[0];
});

const warehouseModel = mongoose.model("warehouse", warehouseSchema);
export default warehouseModel;
