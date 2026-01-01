import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { User, UserSchema } from "./schemas";
import { UserRepository } from "./repositories";
import { UserService } from "./services";
import { UserController } from "./controllers";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UserController],
  providers: [UserRepository, UserService],
  exports: [UserService, UserRepository],
})
export class UsersModule {}
