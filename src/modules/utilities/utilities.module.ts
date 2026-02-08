import { Module } from "@nestjs/common";
import { CloudinaryService } from "./services/cloudinary.service";
import { UtilitiesController } from "./controllers/utilities.controller";

@Module({
  controllers: [UtilitiesController],
  providers: [CloudinaryService],
  exports: [CloudinaryService],
})
export class UtilitiesModule {}
