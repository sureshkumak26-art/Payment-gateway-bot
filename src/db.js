const mongoose=require('mongoose');
const {mongoUri}=require('./config');
module.exports=async()=>{await mongoose.connect(mongoUri);console.log('MongoDB connected');};