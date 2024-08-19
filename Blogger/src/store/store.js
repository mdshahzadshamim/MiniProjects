import { configureStore } from "@reduxjs/toolkit";
import authSlice from "./authSlice";

const store = configureStore({
    reducer: {
        auth: authSlice
        //Todo: add more slices here for posts, i,e; postSlice
    }
});

export default store;