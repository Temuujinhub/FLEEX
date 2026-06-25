import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';

// Serves first-run connection guidance (server host / protocol ports / APN) to
// the device-onboarding wizard. PrismaService + ConfigService are global.
@Module({
  controllers: [OnboardingController],
})
export class OnboardingModule {}
